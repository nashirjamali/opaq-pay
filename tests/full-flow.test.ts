/**
 * End-to-end flow on a local surfnet with the real programs:
 * vault setup → register handle → pay to handle → scan → sweep into the stealth address's own
 * wrapper account → shield (Confidential Transfer) → viewing-key read → unshield → cash out to a
 * fresh address → close, checking that no post-payment transaction mentions the recipient.
 * Requires `anchor build` at the repo root.
 */
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { generateKeyPairSigner, type Address, type KeyPairSigner, type Signature, type TransactionSigner } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStealthSigner,
  decodeViewingKey,
  deriveStealthScalar,
  encodeViewingKey,
  fetchMetaAddress,
  fetchVaultSettings,
  findOwnPayments,
  findWrappedTokenAccount,
  generateMetaKeys,
  getInitVaultInstruction,
  getPayToMetaAddressInstructions,
  getRegisterHandleInstruction,
  getSweepToVaultInstructions,
  getWithdrawFromVaultInstruction,
  registry,
  scanForPayments,
  vault,
  type MetaKeys,
  type OwnPayment,
  type VaultSettings,
} from '@opaq/sdk';
import {
  createDisclosure,
  fetchStealthWrappedBalance,
  getCloseStealthAccountInstructionPlan,
  getConfigureStealthAccountInstructionPlan,
  getShieldInstructions,
  getUnshieldInstructionPlan,
  verifyDisclosure,
} from '@opaq/sdk/confidential';
import { startTestNet, type TestNet } from './helpers.js';

const FEE_BPS = 50; // 0.5%
const PAYMENT = 25_000_000n; // 25 USDC
const FEE = (PAYMENT * BigInt(FEE_BPS)) / 10_000n;

let net: TestNet;
let usdc: Address;
let treasury: Address;
let settings: VaultSettings;

// Actors
let recipientWallet: KeyPairSigner; // owns the handle and the wrapper-token account
let recipientKeys: MetaKeys; // scan + spend seeds, kept off-chain by the recipient
let customer: KeyPairSigner;
let relayer: KeyPairSigner;

// Carried between steps
let paySignature: Parameters<TestNet['announcementsIn']>[0];
let stealthTokenAccount: Address;
let ownPayment: OwnPayment;
let stealthSigner: TransactionSigner;
let stealthWrapped: Address;
const postPayment: Signature[] = []; // every transaction after the payment, checked for links to the recipient

beforeAll(async () => {
  net = await startTestNet();
  recipientWallet = await net.fundedSigner();
  customer = await net.fundedSigner();
  relayer = await net.fundedSigner();
  recipientKeys = generateMetaKeys();

  usdc = await net.createUsdcMint();
  treasury = await net.createAta(net.admin.address, usdc);
  const [config] = await vault.findConfigPda();
  const wrappedMint = await net.createWrappedMint(config);

  await net.send(
    [await getInitVaultInstruction({ admin: net.admin, underlyingMint: usdc, wrappedMint, treasury, feeBps: FEE_BPS })],
    net.admin,
  );
  settings = await fetchVaultSettings(net.rpc);
  await net.mintUsdc(usdc, customer.address, 100_000_000n);
});

afterAll(() => net?.stop());

describe('Opaq full flow', () => {
  it('reads the vault settings back from chain', () => {
    expect(settings.underlyingMint).toBe(usdc);
    expect(settings.treasury).toBe(treasury);
    expect(settings.feeBps).toBe(FEE_BPS);
    expect(settings.underlyingTokenProgram).toBe(TOKEN_PROGRAM_ADDRESS);
  });

  it('registers a handle with the recipient’s meta-address', async () => {
    await net.send(
      [await getRegisterHandleInstruction({ owner: recipientWallet, name: 'raka', meta: recipientKeys })],
      recipientWallet,
    );
    const meta = await fetchMetaAddress(net.rpc, 'raka');
    expect(meta?.owner).toBe(recipientWallet.address);
    expect([...meta!.scanPubkey]).toEqual([...recipientKeys.scanPubkey]);
    expect(await fetchMetaAddress(net.rpc, 'nobody_here')).toBeNull();
  });

  it('pays to the handle through a one-time address', async () => {
    const meta = await fetchMetaAddress(net.rpc, 'raka');
    const pay = await getPayToMetaAddressInstructions({
      payer: customer,
      meta: meta!,
      mint: usdc,
      decimals: 6,
      amount: PAYMENT,
    });
    paySignature = await net.send(pay.instructions, customer);
    stealthTokenAccount = pay.stealthTokenAccount;

    expect(await net.tokenBalance(stealthTokenAccount)).toBe(PAYMENT);
    // Nothing on-chain names the recipient: the funds sit at an address unrelated to their wallet.
    expect(pay.payment.stealthAddress).not.toBe(recipientWallet.address);
  });

  it('lets only the recipient find the payment from the announcement', async () => {
    const announcements = await net.announcementsIn(paySignature);
    expect(announcements).toHaveLength(1);

    const stranger = generateMetaKeys();
    expect(findOwnPayments(stranger.scanSeed, stranger.spendPubkey, announcements)).toHaveLength(0);

    const own = findOwnPayments(recipientKeys.scanSeed, recipientKeys.spendPubkey, announcements);
    expect(own).toHaveLength(1);
    ownPayment = own[0]!;
    const [expectedAta] = await findAssociatedTokenPda({
      owner: ownPayment.stealthAddress,
      mint: usdc,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    expect(expectedAta).toBe(stealthTokenAccount);
  });

  it('scans the chain for the payment without any transaction hint', async () => {
    const scan = await scanForPayments(net.rpc, {
      scanSeed: recipientKeys.scanSeed,
      spendPubkey: recipientKeys.spendPubkey,
      vault: settings,
    });
    expect(scan.complete).toBe(true);
    expect(scan.payments).toHaveLength(1);
    expect(scan.payments[0]).toMatchObject({
      signature: paySignature,
      stealthAddress: ownPayment.stealthAddress,
      tokenAccount: stealthTokenAccount,
      amount: PAYMENT,
    });

    const stranger = generateMetaKeys();
    const none = await scanForPayments(net.rpc, {
      scanSeed: stranger.scanSeed,
      spendPubkey: stranger.spendPubkey,
      vault: settings,
    });
    expect(none.payments).toHaveLength(0);

    // Resuming from the newest signature of the previous run finds nothing new.
    const again = await scanForPayments(net.rpc, {
      scanSeed: recipientKeys.scanSeed,
      spendPubkey: recipientKeys.spendPubkey,
      vault: settings,
      until: scan.newestSignature!,
    });
    expect(again.payments).toHaveLength(0);
  });

  it('sweeps into the stealth address’s own wrapper account, never touching the recipient wallet', async () => {
    stealthSigner = createStealthSigner(deriveStealthScalar(recipientKeys.spendSeed, ownPayment.tweak));
    stealthWrapped = await findWrappedTokenAccount(ownPayment.stealthAddress, settings.wrappedMint);

    const amount = await net.tokenBalance(stealthTokenAccount);
    const sweep = await net.send(
      await getSweepToVaultInstructions({
        stealthSigner,
        vault: settings,
        amount,
        rentRecipient: relayer.address,
        accountPayer: relayer,
      }),
      relayer,
    );
    postPayment.push(sweep);

    expect(await net.tokenBalance(stealthWrapped)).toBe(PAYMENT - FEE);
    expect(await net.tokenBalance(settings.vault)).toBe(PAYMENT - FEE);
    expect(await net.tokenBalance(treasury)).toBe(FEE);
    expect(await net.accountExists(stealthTokenAccount)).toBe(false);
    expect(await net.accountExists(await findWrappedTokenAccount(recipientWallet.address, settings.wrappedMint))).toBe(false);

    // The scanner now reports where the funds live.
    const scan = await scanForPayments(net.rpc, {
      scanSeed: recipientKeys.scanSeed,
      spendPubkey: recipientKeys.spendPubkey,
      vault: settings,
    });
    expect(scan.payments).toHaveLength(1);
    expect(scan.payments[0]).toMatchObject({
      amount: 0n,
      wrappedTokenAccount: stealthWrapped,
      wrappedAccountExists: true,
      wrappedPublicAmount: PAYMENT - FEE,
    });
  });

  it('shields the stealth balance; only the viewing key decrypts it', async () => {
    const input = { rpc: net.rpc, payer: relayer, stealthSigner, scanSeed: recipientKeys.scanSeed, vault: settings };
    postPayment.push(...(await net.sendPlan(await getConfigureStealthAccountInstructionPlan(input), relayer)));
    postPayment.push(await net.send(await getShieldInstructions(input), relayer));

    // The public amount on chain is gone…
    expect(await net.tokenBalance(stealthWrapped)).toBe(0n);
    // …but an auditor holding only the viewing key can find and decrypt it.
    const viewing = decodeViewingKey(encodeViewingKey(recipientKeys));
    const balance = await fetchStealthWrappedBalance(net.rpc, {
      scanSeed: viewing.scanSeed,
      stealthAddress: ownPayment.stealthAddress,
      vault: settings,
    });
    expect(balance).toMatchObject({ confidential: true, publicAmount: 0n, pending: 0n, available: PAYMENT - FEE });

    const stranger = generateMetaKeys();
    await expect(
      fetchStealthWrappedBalance(net.rpc, { scanSeed: stranger.scanSeed, stealthAddress: ownPayment.stealthAddress, vault: settings }),
    ).rejects.toThrow();
  });

  it('discloses one time range to an auditor without the scan seed', async () => {
    const { payments } = await scanForPayments(net.rpc, {
      scanSeed: recipientKeys.scanSeed,
      spendPubkey: recipientKeys.spendPubkey,
      vault: settings,
    });
    const disclosure = createDisclosure({
      scanSeed: recipientKeys.scanSeed,
      payments,
      from: new Date(Date.now() - 3_600_000),
      to: new Date(Date.now() + 3_600_000),
    });
    expect(disclosure.payments).toHaveLength(1);
    expect(JSON.stringify(disclosure)).not.toContain(Buffer.from(recipientKeys.scanSeed).toString('hex'));

    const report = await verifyDisclosure(net.rpc, disclosure, { vault: settings });
    expect(report.totalPaid).toBe(PAYMENT);
    expect(report.rows[0]).toMatchObject({ valid: true, paid: PAYMENT, current: { exists: true, shielded: PAYMENT - FEE } });

    // Keys that do not belong to the account, or a range with nothing in it, prove nothing.
    const tampered = { ...disclosure, payments: [{ ...disclosure.payments[0]!, aeSeed: disclosure.payments[0]!.elgamalSeed }] };
    expect((await verifyDisclosure(net.rpc, tampered, { vault: settings })).rows[0]!.valid).toBe(false);
    const empty = createDisclosure({ scanSeed: recipientKeys.scanSeed, payments, from: new Date(0), to: new Date(1000) });
    expect(empty.payments).toHaveLength(0);
  });

  it('unshields, cashes out 1:1 to a fresh address and closes the stealth account', async () => {
    const input = { rpc: net.rpc, payer: relayer, stealthSigner, scanSeed: recipientKeys.scanSeed, vault: settings };
    postPayment.push(...(await net.sendPlan(await getUnshieldInstructionPlan(input), relayer)));
    expect(await net.tokenBalance(stealthWrapped)).toBe(PAYMENT - FEE);

    const cashOut = await generateKeyPairSigner();
    const [cashOutUsdc] = await findAssociatedTokenPda({
      owner: cashOut.address,
      mint: usdc,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    postPayment.push(
      await net.send(
        [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: relayer,
            ata: cashOutUsdc,
            owner: cashOut.address,
            mint: usdc,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }),
          await getWithdrawFromVaultInstruction({
            owner: stealthSigner,
            vault: settings,
            amount: PAYMENT - FEE,
            destination: cashOutUsdc,
          }),
        ],
        relayer,
      ),
    );
    expect(await net.tokenBalance(cashOutUsdc)).toBe(PAYMENT - FEE);
    expect(await net.tokenBalance(settings.vault)).toBe(0n);

    const rent = (await net.rpc.getBalance(stealthWrapped).send()).value;
    const relayerBefore = (await net.rpc.getBalance(relayer.address).send()).value;
    postPayment.push(
      ...(await net.sendPlan(await getCloseStealthAccountInstructionPlan({ ...input, rentRecipient: relayer.address }), relayer)),
    );
    expect(await net.accountExists(stealthWrapped)).toBe(false);
    expect((await net.rpc.getBalance(relayer.address).send()).value).toBeGreaterThan(relayerBefore + rent - 100_000n);
  });

  it('never mentions the recipient wallet or handle after the payment', async () => {
    const [handle] = await registry.findHandlePda({ name: 'raka' });
    for (const signature of postPayment) {
      const accounts = await net.accountsIn(signature);
      expect(accounts).not.toContain(recipientWallet.address);
      expect(accounts).not.toContain(handle);
    }
    expect(postPayment.length).toBeGreaterThan(4);
  });

  it('rejects a sweep signed by someone other than the stealth key', async () => {
    const meta = await fetchMetaAddress(net.rpc, 'raka');
    const pay = await getPayToMetaAddressInstructions({ payer: customer, meta: meta!, mint: usdc, decimals: 6, amount: 1_000_000n });
    await net.send(pay.instructions, customer);

    const impostor = createStealthSigner(123456789n);
    const instructions = await getSweepToVaultInstructions({
      stealthSigner: impostor,
      vault: settings,
      amount: 1_000_000n,
      rentRecipient: relayer.address,
      accountPayer: relayer,
    });
    await expect(net.send(instructions, relayer)).rejects.toThrow();
    expect(await net.tokenBalance(pay.stealthTokenAccount)).toBe(1_000_000n);
  });
});
