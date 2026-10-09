/**
 * End-to-end smoke test against the shared devnet deployment, using only SDK helpers:
 *
 *   register @handle (if needed) → pay → scan → sweep into the stealth address's own wrapper
 *   account → shield → viewing-key read → unshield → cash out to a fresh address → close
 *   → check that no post-payment transaction mentions the recipient's wallet or handle
 *
 * The admin wallet is recipient-wallet and payer; a separate relayer keypair pays every
 * post-payment transaction. State lives in OPAQ_SMOKE_DIR (outside the repo):
 * `<handle>-seed.json` (recipient master seed, created on first run) and `smoke-state.json`.
 * Rerunning resumes from what is on chain.
 *
 *   OPAQ_SMOKE_DIR=/path/outside/repo npx tsx scripts/smoke-devnet.ts [handle]
 *
 * Env: OPAQ_RPC_URL, OPAQ_KEYPAIR (see init-devnet.ts), OPAQ_SMOKE_AMOUNT (base units, default 200000).
 */
import { getTransferSolInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  sequentialInstructionPlan,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  configFromEnv,
  createStealthSigner,
  decodeViewingKey,
  deriveMetaKeysFromMasterSeed,
  deriveStealthScalar,
  encodeViewingKey,
  fetchMetaAddress,
  fetchVaultSettings,
  getPayToMetaAddressInstructions,
  getRegisterHandleInstruction,
  getSweepToVaultInstructions,
  getWithdrawFromVaultInstruction,
  scanForPayments,
  type DetectedPayment,
} from '@opaq/sdk';
import {
  fetchStealthWrappedBalance,
  getCloseStealthAccountInstructionPlan,
  getConfigureStealthAccountInstructionPlan,
  getShieldInstructions,
  getUnshieldInstructionPlan,
} from '@opaq/sdk/confidential';

const env = process.env;
const handle = process.argv[2] ?? 'opaq_test';
const amount = BigInt(env.OPAQ_SMOKE_AMOUNT ?? 200_000);
const dir = env.OPAQ_SMOKE_DIR;
if (!dir) throw new Error('Set OPAQ_SMOKE_DIR to a directory outside the repo');

const rpcUrl = env.OPAQ_RPC_URL ?? 'https://api.devnet.solana.com';
const rpc = createSolanaRpc(rpcUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, 'ws')),
});
const programs = configFromEnv({ ...env, OPAQ_CLUSTER: 'devnet' }).programs;

// --- local state ---------------------------------------------------------------------------
type State = { paySignature?: string; relayerSeed?: string; cashOutSeed?: string; postPayment: string[] };
const statePath = join(dir, 'smoke-state.json');
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { postPayment: [] };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
function secret(key: 'relayerSeed' | 'cashOutSeed'): Uint8Array {
  state[key] ??= randomBytes(32).toString('hex');
  save();
  return new Uint8Array(Buffer.from(state[key]!, 'hex'));
}
const seedPath = join(dir, `${handle}-seed.json`);
if (!existsSync(seedPath)) {
  writeFileSync(seedPath, JSON.stringify({ master: randomBytes(32).toString('hex') }), { mode: 0o600 });
}
const keys = deriveMetaKeysFromMasterSeed(new Uint8Array(Buffer.from(JSON.parse(readFileSync(seedPath, 'utf8')).master, 'hex')));

const wallet = await createKeyPairSignerFromBytes(
  new Uint8Array(JSON.parse(readFileSync(env.OPAQ_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, 'utf8'))),
);
const relayer = await createKeyPairSignerFromPrivateKeyBytes(secret('relayerSeed'));
const cashOut = await createKeyPairSignerFromPrivateKeyBytes(secret('cashOutSeed'));

// --- sending ---------------------------------------------------------------------------------
/** True when the error or any error in its `cause` chain matches. */
function causedBy(error: unknown, test: (e: { message?: string; context?: Record<string, unknown> }) => boolean): boolean {
  for (let e = error as { message?: string; context?: Record<string, unknown>; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (test(e)) return true;
  }
  return false;
}
const isRateLimited = (error: unknown) =>
  causedBy(error, (e) => e.context?.statusCode === 429 || /429|Too Many Requests/.test(e.message ?? ''));

/** The public devnet RPC rate-limits (429) during proof-heavy plans; back off and retry. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimited(error) || i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * i));
    }
  }
}

async function run(label: string, plan: InstructionPlan, feePayer: KeyPairSigner, postPayment = true): Promise<Signature[]> {
  const signatures: Signature[] = [];
  const planner = createTransactionPlanner({
    createTransactionMessage: async () => {
      const { value: latestBlockhash } = await withRetry(() => rpc.getLatestBlockhash().send());
      return pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      );
    },
  });
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (_context, message) => {
      const transaction = await signTransactionMessageWithSigners(message);
      assertIsTransactionWithBlockhashLifetime(transaction);
      try {
        await withRetry(() => sendAndConfirm(transaction, { commitment: 'confirmed' }));
      } catch (error) {
        // A retry after a 429 can resend a transaction that already landed; its signature is fixed.
        if (!causedBy(error, (e) => /already been processed/.test(e.message ?? ''))) throw error;
      }
      const signature = getSignatureFromTransaction(transaction);
      signatures.push(signature);
      if (postPayment) {
        state.postPayment.push(signature);
        save();
      }
      return { signature };
    },
  });
  await executor(await planner(plan));
  console.log(`  ${label}: ${signatures.length} tx, last https://explorer.solana.com/tx/${signatures.at(-1)}?cluster=devnet`);
  return signatures;
}
const ixs = (instructions: Instruction[]) => sequentialInstructionPlan(instructions);

async function transactionAccounts(signature: Signature): Promise<string[]> {
  for (let i = 0; i < 8; i++) {
    const tx = await withRetry(() =>
      rpc.getTransaction(signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).send(),
    );
    if (tx) {
      return [
        ...tx.transaction.message.accountKeys,
        ...(tx.meta?.loadedAddresses?.writable ?? []),
        ...(tx.meta?.loadedAddresses?.readonly ?? []),
      ];
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`transaction ${signature} not found`);
}

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

// --- 0. setup --------------------------------------------------------------------------------
const settings = await fetchVaultSettings(rpc, programs);
console.log(`recipient wallet ${wallet.address}\nrelayer          ${relayer.address}\ncash-out address ${cashOut.address}`);

// The relayer must not be funded from the recipient's wallet: that one transfer would link the
// wallet to every stealth account the relayer serves. Use the devnet faucet; only fall back to
// the wallet when explicitly allowed, and then the linkability check below fails on purpose.
const relayerLamports = (await rpc.getBalance(relayer.address, { commitment: 'confirmed' }).send()).value;
if (relayerLamports < 30_000_000n) {
  console.log('\n0. fund the relayer');
  try {
    const signature = await rpc.requestAirdrop(relayer.address, lamports(1_000_000_000n)).send();
    for (let i = 0; i < 30; i++) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      if (value[0]?.confirmationStatus === 'confirmed' || value[0]?.confirmationStatus === 'finalized') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.log('  airdropped 1 SOL from the devnet faucet');
  } catch (error) {
    if (env.OPAQ_SMOKE_ALLOW_WALLET_FUNDED_RELAYER !== '1') {
      throw new Error(
        `Faucet airdrop failed (${String(error).slice(0, 120)}). Fund ${relayer.address} from a wallet unrelated to the recipient ` +
          '(e.g. https://faucet.solana.com), or set OPAQ_SMOKE_ALLOW_WALLET_FUNDED_RELAYER=1 to accept a linked relayer.',
      );
    }
    await run('fund relayer from the recipient wallet (links them!)', ixs([getTransferSolInstruction({ source: wallet, destination: relayer.address, amount: 60_000_000n })]), wallet, false);
  }
}

// --- 1. register -----------------------------------------------------------------------------
console.log(`\n1. @${handle}`);
let meta = await fetchMetaAddress(rpc, handle, programs);
if (!meta) {
  await run('register_handle', ixs([await getRegisterHandleInstruction({ owner: wallet, name: handle, meta: keys, programs })]), wallet, false);
  meta = await fetchMetaAddress(rpc, handle, programs);
}
check(meta?.owner === wallet.address, 'handle belongs to this wallet');
check(Buffer.compare(Buffer.from(meta!.scanPubkey), Buffer.from(keys.scanPubkey)) === 0, `handle uses the keys in ${seedPath}`);

// --- 2. pay ----------------------------------------------------------------------------------
console.log(`\n2. pay ${amount}`);
if (!state.paySignature) {
  const pay = await getPayToMetaAddressInstructions({
    payer: wallet,
    meta: meta!,
    mint: settings.underlyingMint,
    decimals: settings.decimals,
    amount,
    programs,
  });
  state.paySignature = (await run('pay + announce', ixs(pay.instructions), wallet, false))[0];
  state.postPayment = [];
  save();
} else {
  console.log(`  resuming payment ${state.paySignature}`);
}

// --- 3. scan ---------------------------------------------------------------------------------
console.log('\n3. scan');
const scanInput = {
  scanSeed: keys.scanSeed,
  spendPubkey: keys.spendPubkey,
  vault: settings,
  programs,
  includeSwept: true,
  maxSignatures: 300,
};
let payment: DetectedPayment | undefined;
for (let attempt = 1; attempt <= 6 && !payment; attempt++) {
  payment = (await withRetry(() => scanForPayments(rpc, scanInput))).payments.find((p) => p.signature === state.paySignature);
  if (!payment) await new Promise((resolve) => setTimeout(resolve, 4000));
}
check(payment !== undefined, 'scanner found the payment from chain data only');
const stealthSigner = createStealthSigner(deriveStealthScalar(keys.spendSeed, payment!.tweak));
const ct = { rpc, payer: relayer, stealthSigner, scanSeed: keys.scanSeed, vault: settings };
console.log(`  stealth address ${stealthSigner.address}`);

if (!payment!.wrappedAccountExists && payment!.amount === 0n) {
  console.log('  already cashed out and closed');
} else {
  // --- 4. sweep ------------------------------------------------------------------------------
  console.log('\n4. sweep into the stealth address’s own wrapper account (relayer pays)');
  if (payment!.amount > 0n) {
    await run(
      'create wrapper account + deposit + close USDC account',
      ixs(
        await getSweepToVaultInstructions({
          stealthSigner,
          vault: settings,
          amount: payment!.amount,
          rentRecipient: relayer.address,
          accountPayer: relayer,
        }),
      ),
      relayer,
    );
  }
  let balance = await fetchStealthWrappedBalance(rpc, { scanSeed: keys.scanSeed, stealthAddress: stealthSigner.address, vault: settings });
  const expected = amount - (amount * BigInt(settings.feeBps)) / 10_000n;
  check(balance.total === expected, `stealth wrapper account holds ${expected} (amount minus ${settings.feeBps} bps)`);

  // --- 5. shield -----------------------------------------------------------------------------
  console.log('\n5. shield');
  if (!balance.confidential) await run('configure confidential account', await getConfigureStealthAccountInstructionPlan(ct), relayer);
  const shield = await getShieldInstructions(ct);
  if (shield.length) await run('deposit + apply (one tx)', ixs(shield), relayer);
  balance = await fetchStealthWrappedBalance(rpc, { scanSeed: keys.scanSeed, stealthAddress: stealthSigner.address, vault: settings });
  check(balance.publicAmount === 0n && balance.available === expected, 'public amount on chain is 0, all of it is shielded');

  // --- 6. viewing key ------------------------------------------------------------------------
  console.log('\n6. auditor with only the viewing key');
  const viewing = decodeViewingKey(encodeViewingKey(keys));
  const seen = (await withRetry(() => scanForPayments(rpc, { ...scanInput, scanSeed: viewing.scanSeed, spendPubkey: viewing.spendPubkey }))).payments.find(
    (p) => p.signature === state.paySignature,
  );
  const audited = await fetchStealthWrappedBalance(rpc, { scanSeed: viewing.scanSeed, stealthAddress: seen!.stealthAddress, vault: settings });
  check(audited.available === expected, `auditor finds the payment and decrypts ${audited.available}`);

  // --- 7. unshield + cash out ----------------------------------------------------------------
  console.log('\n7. unshield and cash out to a fresh address');
  await run('unshield', await getUnshieldInstructionPlan(ct), relayer);
  const [cashOutUsdc] = await findAssociatedTokenPda({ owner: cashOut.address, mint: settings.underlyingMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  await run(
    'vault withdraw',
    ixs([
      getCreateAssociatedTokenIdempotentInstruction({
        payer: relayer,
        ata: cashOutUsdc,
        owner: cashOut.address,
        mint: settings.underlyingMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
      await getWithdrawFromVaultInstruction({ owner: stealthSigner, vault: settings, amount: expected, destination: cashOutUsdc }),
    ]),
    relayer,
  );

  // --- 8. close ------------------------------------------------------------------------------
  console.log('\n8. close the stealth wrapper account (rent back to the relayer)');
  await run('empty + close', await getCloseStealthAccountInstructionPlan({ ...ct, rentRecipient: relayer.address }), relayer);
  balance = await fetchStealthWrappedBalance(rpc, { scanSeed: keys.scanSeed, stealthAddress: stealthSigner.address, vault: settings });
  check(!balance.exists, 'stealth wrapper account closed');
}

// --- 9. linkability ------------------------------------------------------------------------
console.log('\n9. post-payment transactions vs. the recipient');
const forbidden = new Set<string>([wallet.address, meta!.handle]);
let leaks = 0;
for (const signature of state.postPayment) {
  for (const account of await transactionAccounts(signature as Signature)) {
    if (forbidden.has(account)) {
      leaks++;
      console.log(`  LEAK ${account} in ${signature}`);
    }
  }
}
check(leaks === 0, `${state.postPayment.length} post-payment transactions mention neither wallet nor handle`);

// One hop out: the relayer's own history must not touch the recipient's wallet either
// (e.g. a funding transfer), or every account it served is linked to that wallet.
const relayerHistory = await withRetry(() => rpc.getSignaturesForAddress(relayer.address, { limit: 1000 }).send());
const linking: string[] = [];
for (const { signature } of relayerHistory) {
  if ((await transactionAccounts(signature)).includes(wallet.address)) linking.push(signature);
}
if (linking.length) console.log(`  relayer history touches the recipient wallet in: ${linking.slice(0, 3).join(', ')}`);
check(linking.length === 0, 'the relayer is not linked to the recipient wallet');
delete state.paySignature; // the next run makes a new payment
save();
console.log('\nSMOKE TEST PASSED');
