/**
 * Indexer + API + relayer against a local surfnet (real programs) and a temp Postgres.
 * Requires `anchor build` at the repo root.
 *
 * The whole recipient lifecycle runs through the relayer: sweep, configure, shield, unshield,
 * cash out, close; the stealth address never holds SOL. Then the relayer is attacked.
 */
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  sequentialInstructionPlan,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CCTP_MESSAGE_TRANSMITTER_PROGRAM_ADDRESS,
  CCTP_RECEIVE_MESSAGE_DISCRIMINATOR,
  CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ADDRESS,
  createIndexerClient,
  createRelayerClient,
  createStealthSigner,
  createThrowawaySigner,
  deriveStealthScalar,
  fetchMetaAddress,
  fetchVaultSettings,
  generateMetaKeys,
  getCctpAnnounceInstruction,
  getInitVaultInstruction,
  getPayToMetaAddressInstructions,
  getPrepareCctpPaymentInstructions,
  getProposeAdminInstruction,
  getRegisterHandleInstruction,
  getRelayerSigner,
  getSweepToVaultInstructions,
  getWithdrawFromVaultInstruction,
  LOCALNET_PROGRAMS,
  RelayerRejectedError,
  scanForPayments,
  scanIndexerForPayments,
  sendPlanViaRelayer,
  vault,
  type DetectedPayment,
  type MetaKeys,
  type VaultSettings,
} from '@opaq/sdk';
import {
  fetchStealthWrappedBalance,
  getCloseStealthAccountInstructionPlan,
  getConfigureStealthAccountInstructionPlan,
  getShieldInstructions,
  getUnshieldInstructionPlan,
} from '@opaq/sdk/confidential';
import { startTestNet, type TestNet } from '../../../tests/helpers.js';
import { createApp } from '../src/app.js';
import { createDb, migrate, type Db } from '../src/db.js';
import { createIndexer, type Indexer } from '../src/indexer.js';
import { checkRelayPolicy, createRelayer } from '../src/relayer.js';
import { startPostgres } from './postgres.js';

const PAYMENT = 10_000_000n;
const FEE_BPS = 50;
const NET = PAYMENT - (PAYMENT * BigInt(FEE_BPS)) / 10_000n;

let net: TestNet;
let pg: Awaited<ReturnType<typeof startPostgres>>;
let db: Db;
let indexer: Indexer;
let app: ReturnType<typeof createApp>;
let settings: VaultSettings;
let usdc: Address;
let relayerKey: KeyPairSigner;
let customer: KeyPairSigner;
let keys: MetaKeys;
let payment: DetectedPayment;

/** Lets the SDK clients talk to the in-process Hono app. */
const appFetch = ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), init)) as typeof fetch;
const relayerClient = () => createRelayerClient({ url: 'http://opaq.test', fetch: appFetch });

beforeAll(async () => {
  net = await startTestNet();
  pg = await startPostgres();
  db = createDb(pg.url);
  await migrate(db);
  await migrate(db); // idempotent

  usdc = await net.createUsdcMint();
  const treasury = await net.createAta(net.admin.address, usdc);
  const [config] = await vault.findConfigPda();
  const wrappedMint = await net.createWrappedMint(config);
  await net.send(
    [await getInitVaultInstruction({ admin: net.admin, underlyingMint: usdc, wrappedMint, treasury, feeBps: FEE_BPS })],
    net.admin,
  );
  settings = await fetchVaultSettings(net.rpc);

  relayerKey = await net.fundedSigner(5_000_000_000);
  customer = await net.fundedSigner();
  await net.mintUsdc(usdc, customer.address, 100_000_000n);
  keys = generateMetaKeys();
  const owner = await net.fundedSigner();
  await net.send([await getRegisterHandleInstruction({ owner, name: 'toko', meta: keys })], owner);

  indexer = createIndexer({ rpc: net.rpc, db, programs: LOCALNET_PROGRAMS, commitment: 'confirmed' });
  const relayer = createRelayer({
    rpc: net.rpc,
    db,
    signer: relayerKey,
    programs: LOCALNET_PROGRAMS,
    maxLamportsPerTransaction: 20_000_000n,
    dailyLamportBudget: 1_000_000_000n,
    requestsPerMinute: 1000,
  });
  app = createApp({ db, indexer, relayer, trustProxy: false });
});

afterAll(async () => {
  await db?.end();
  pg?.stop();
  net?.stop();
});

describe('indexer and announcement feed', () => {
  it('indexes payments once and serves them to clients that match locally', async () => {
    const meta = await fetchMetaAddress(net.rpc, 'toko');
    for (let i = 0; i < 3; i++) {
      // Two payments to someone else, one to us: the feed carries all of them.
      const to = i === 1 ? meta! : generateMetaKeys();
      const pay = await getPayToMetaAddressInstructions({ payer: customer, meta: to, mint: usdc, decimals: 6, amount: PAYMENT });
      await net.send(pay.instructions, customer);
    }

    expect(await indexer.syncOnce()).toBe(3);
    expect(await indexer.syncOnce()).toBe(0); // cursor advanced, inserts idempotent

    const response = await app.request('/v1/announcements?limit=2');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable'); // full page
    const page = (await response.json()) as { items: unknown[]; next: string; hasMore: boolean };
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect((await app.request('/v1/announcements?after=abc')).status).toBe(400);

    const scan = await scanIndexerForPayments(net.rpc, createIndexerClient({ url: 'http://opaq.test', fetch: appFetch }), {
      scanSeed: keys.scanSeed,
      spendPubkey: keys.spendPubkey,
      vault: settings,
      pageSize: 2,
    });
    expect(scan.complete).toBe(true);
    expect(scan.payments).toHaveLength(1);
    payment = scan.payments[0]!;
    expect(payment.amount).toBe(PAYMENT);

    // Resuming from the cursor finds nothing new.
    const again = await scanIndexerForPayments(net.rpc, createIndexerClient({ url: 'http://opaq.test', fetch: appFetch }), {
      scanSeed: keys.scanSeed,
      spendPubkey: keys.spendPubkey,
      vault: settings,
      after: scan.cursor,
    });
    expect(again.payments).toHaveLength(0);
  });
});

describe('relayer', () => {
  it('runs the whole recipient lifecycle without the stealth address ever holding SOL', async () => {
    const relayer = relayerClient();
    const payer = await getRelayerSigner(relayer);
    expect(payer.address).toBe(relayerKey.address);
    const stealthSigner = createStealthSigner(deriveStealthScalar(keys.spendSeed, payment.tweak));
    const ct = { rpc: net.rpc, payer, stealthSigner, scanSeed: keys.scanSeed, vault: settings };
    const relayerBefore = (await net.rpc.getBalance(relayerKey.address).send()).value;
    const send = (plan: Parameters<typeof sendPlanViaRelayer>[0]['plan']) => sendPlanViaRelayer({ rpc: net.rpc, relayer, plan });

    await send(
      sequentialInstructionPlan(
        await getSweepToVaultInstructions({
          stealthSigner,
          vault: settings,
          amount: payment.amount,
          rentRecipient: payer.address,
          accountPayer: payer,
        }),
      ),
    );
    await send(await getConfigureStealthAccountInstructionPlan(ct));
    await send(sequentialInstructionPlan(await getShieldInstructions(ct)));
    let balance = await fetchStealthWrappedBalance(net.rpc, { scanSeed: keys.scanSeed, stealthAddress: stealthSigner.address, vault: settings });
    expect(balance).toMatchObject({ publicAmount: 0n, available: NET });

    await send(await getUnshieldInstructionPlan(ct));
    const cashOut = await generateKeyPairSigner();
    const [cashOutUsdc] = await findAssociatedTokenPda({ owner: cashOut.address, mint: usdc, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    await send(
      sequentialInstructionPlan([
        getCreateAssociatedTokenIdempotentInstruction({
          payer,
          ata: cashOutUsdc,
          owner: cashOut.address,
          mint: usdc,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        }),
        await getWithdrawFromVaultInstruction({ owner: stealthSigner, vault: settings, amount: NET, destination: cashOutUsdc }),
      ]),
    );
    await send(await getCloseStealthAccountInstructionPlan({ ...ct, rentRecipient: payer.address }));

    expect(await net.tokenBalance(cashOutUsdc)).toBe(NET);
    balance = await fetchStealthWrappedBalance(net.rpc, { scanSeed: keys.scanSeed, stealthAddress: stealthSigner.address, vault: settings });
    expect(balance.exists).toBe(false);
    expect((await net.rpc.getBalance(stealthSigner.address).send()).value).toBe(0n);

    // The relayer is out of pocket only for the cash-out ATA it created for someone else, plus fees.
    const spent = relayerBefore - (await net.rpc.getBalance(relayerKey.address).send()).value;
    expect(spent).toBeLessThan(2_500_000n);
  });

  /** A transaction with the relayer as fee payer, signed by everyone else it names. */
  async function wire(instructions: Instruction[]) {
    const { value: latestBlockhash } = await net.rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(createNoopSigner(relayerKey.address), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message));
  }

  async function expectRejected(transaction: string, reason: RegExp) {
    const error = await relayerClient()
      .relay(transaction)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RelayerRejectedError);
    expect((error as RelayerRejectedError).reason).toMatch(reason);
  }

  it('is idempotent: relaying the same transaction twice returns the same signature', async () => {
    const owner = await generateKeyPairSigner();
    const [ata] = await findAssociatedTokenPda({ owner: owner.address, mint: usdc, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const transaction = await wire([
      getCreateAssociatedTokenIdempotentInstruction({
        payer: createNoopSigner(relayerKey.address),
        ata,
        owner: owner.address,
        mint: usdc,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
    ]);
    const first = await relayerClient().relay(transaction);
    const second = await relayerClient().relay(transaction);
    expect(second).toBe(first);
    const { rows } = await db.query('select count(*)::int as n from relay_log where signature = $1', [first]);
    expect(rows[0].n).toBe(1); // sent and budgeted once
  });

  it('refuses to send its own SOL anywhere', async () => {
    const thief = await generateKeyPairSigner();
    await expectRejected(
      await wire([getTransferSolInstruction({ source: createNoopSigner(relayerKey.address), destination: thief.address, amount: 1_000_000n })]),
      /only CreateAccount/,
    );
  });

  it('refuses closes that refund someone other than the relayer', async () => {
    const thief = await generateKeyPairSigner();
    const owner = await net.fundedSigner();
    const ata = await net.createAta(owner.address, usdc);
    await expectRejected(
      await wire([getCloseAccountInstruction({ account: ata, destination: thief.address, owner })]),
      /refund the relayer/,
    );
  });

  it('refuses unknown programs, admin instructions and missing signatures', async () => {
    const admin = createNoopSigner(net.admin.address);
    await expectRejected(
      await wire([await getProposeAdminInstruction({ admin, newAdmin: customer.address })]),
      /missing signature|only vault deposit/,
    );
    const memo: Instruction = { programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address, data: new Uint8Array([104, 105]) };
    await expectRejected(await wire([memo]), /not allowed/);
  });

  it('refuses transactions with a different fee payer', async () => {
    const other = await net.fundedSigner();
    const { value: latestBlockhash } = await net.rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(other, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions([], m),
    );
    await expectRejected(
      getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message)),
      /fee payer/,
    );
  });
});

describe('relayer for a payer on another chain', () => {
  // The payer has no Solana wallet: the relayer pays, and throwaway keys fill the signer slots.
  const relayerSigner = () => createNoopSigner(relayerKey.address);

  async function wire(instructions: Instruction[]) {
    const { value: latestBlockhash } = await net.rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(relayerSigner(), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(message));
  }
  const policyOf = async (instructions: Instruction[]) =>
    checkRelayPolicy(getTransactionDecoder().decode(Buffer.from(await wire(instructions), 'base64')), {
      relayer: relayerKey.address,
      programs: LOCALNET_PROGRAMS,
    });

  /** The shape of CCTP `receive_message` that the policy looks at: payer, caller, receiver at 5, then the rest. */
  async function cctpReceive(input: { payer: TransactionSigner; caller: TransactionSigner; receiver?: Address; handedOn?: Address; data?: number[] }): Promise<Instruction> {
    const filler = async () => ({ address: (await generateKeyPairSigner()).address, role: AccountRole.READONLY });
    return {
      programAddress: CCTP_MESSAGE_TRANSMITTER_PROGRAM_ADDRESS,
      accounts: [
        { address: input.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: input.payer },
        { address: input.caller.address, role: AccountRole.READONLY_SIGNER, signer: input.caller },
        await filler(),
        await filler(),
        { ...(await filler()), role: AccountRole.WRITABLE },
        { address: input.receiver ?? CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        await filler(),
        { address: input.handedOn ?? (await generateKeyPairSigner()).address, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array(input.data ?? [...CCTP_RECEIVE_MESSAGE_DISCRIMINATOR, 0, 0, 0, 0, 0, 0, 0, 0]),
    } as Instruction;
  }

  it('creates the stealth USDC account and relays an announcement signed by a throwaway key', async () => {
    const relayer = relayerClient();
    const payer = await getRelayerSigner(relayer);
    const recipient = generateMetaKeys();
    const prepared = await getPrepareCctpPaymentInstructions({ accountPayer: payer, meta: recipient, mint: usdc });
    const announce = await getCctpAnnounceInstruction({ announcer: createThrowawaySigner(), payment: prepared.payment });
    await sendPlanViaRelayer({ rpc: net.rpc, relayer, plan: sequentialInstructionPlan([...prepared.instructions, announce]) });

    // The recipient finds it before any funds arrive, and can tell that it is still in flight.
    const scan = await scanForPayments(net.rpc, {
      scanSeed: recipient.scanSeed,
      spendPubkey: recipient.spendPubkey,
      vault: settings,
      includeSwept: true,
      commitment: 'confirmed',
    });
    expect(scan.payments).toHaveLength(1);
    expect(scan.payments[0]).toMatchObject({
      stealthAddress: prepared.payment.stealthAddress,
      tokenAccount: prepared.stealthTokenAccount,
      tokenAccountExists: true,
      amount: 0n,
      wrappedAccountExists: false,
    });
  });

  it('never announces in its own name and never registers handles', async () => {
    const prepared = await getPrepareCctpPaymentInstructions({ accountPayer: relayerSigner(), meta: generateMetaKeys(), mint: usdc });
    expect(await policyOf([await getCctpAnnounceInstruction({ announcer: relayerSigner(), payment: prepared.payment })])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/may not take part in registry/),
    });
    const owner = await net.fundedSigner();
    expect(await policyOf([await getRegisterHandleInstruction({ owner, name: 'relayed', meta: generateMetaKeys() })])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/only announce is relayed/),
    });
  });

  it('pays for a CCTP delivery as payer and caller, the only signer that fits', async () => {
    const result = await policyOf([await cctpReceive({ payer: relayerSigner(), caller: relayerSigner() })]);
    expect(result).toMatchObject({ ok: true, signatureCount: 1 });
  });

  it('refuses to be handed on to the CCTP receiver, or to reach another receiver', async () => {
    expect(
      await policyOf([await cctpReceive({ payer: relayerSigner(), caller: relayerSigner(), handedOn: relayerKey.address })]),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/only pay for and call the CCTP delivery/) });
    const evil = (await generateKeyPairSigner()).address;
    expect(await policyOf([await cctpReceive({ payer: relayerSigner(), caller: relayerSigner(), receiver: evil })])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/receiver must be the token messenger/),
    });
  });

  it('refuses every other CCTP instruction', async () => {
    const other = await cctpReceive({ payer: relayerSigner(), caller: relayerSigner(), data: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(await policyOf([other])).toMatchObject({ ok: false, reason: expect.stringMatching(/only CCTP receive_message/) });
  });
});

