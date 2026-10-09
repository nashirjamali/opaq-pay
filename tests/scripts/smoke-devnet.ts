/**
 * End-to-end smoke test against the shared devnet deployment:
 * register handle → pay USDC → scan → sweep into the vault → withdraw.
 * One wallet plays recipient, payer and relayer. The recipient's master seed is written to
 * OPAQ_SMOKE_SEED_FILE before anything is sent, so a failed run never strands funds.
 *
 *   OPAQ_SMOKE_SEED_FILE=/path/seed.json npx tsx scripts/smoke-devnet.ts [handle]
 *
 * Env: OPAQ_RPC_URL, OPAQ_KEYPAIR (see init-devnet.ts), OPAQ_SMOKE_AMOUNT (base units, default 1000000).
 */
import { findAssociatedTokenPda } from '@solana-program/token';
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type Signature,
} from '@solana/kit';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  configFromEnv,
  createStealthSigner,
  deriveMetaKeysFromMasterSeed,
  deriveStealthScalar,
  fetchMetaAddress,
  fetchVaultSettings,
  getCreateWrappedTokenAccountInstruction,
  getPayToMetaAddressInstructions,
  getRegisterHandleInstruction,
  getSweepToVaultInstructions,
  getWithdrawFromVaultInstruction,
  scanForPayments,
  TOKEN_PROGRAM_ADDRESS,
} from '@opaq/sdk';

const env = process.env;
const handle = process.argv[2] ?? 'opaq_test';
const amount = BigInt(env.OPAQ_SMOKE_AMOUNT ?? 1_000_000);
const seedFile = env.OPAQ_SMOKE_SEED_FILE;
if (!seedFile) throw new Error('Set OPAQ_SMOKE_SEED_FILE to a path outside the repo');

const rpcUrl = env.OPAQ_RPC_URL ?? 'https://api.devnet.solana.com';
const rpc = createSolanaRpc(rpcUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, 'ws')),
});
const programs = configFromEnv({ ...env, OPAQ_CLUSTER: 'devnet' }).programs;
const wallet = await createKeyPairSignerFromBytes(
  new Uint8Array(JSON.parse(readFileSync(env.OPAQ_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, 'utf8'))),
);

async function send(label: string, instructions: Instruction[]): Promise<Signature> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(wallet, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(transaction);
  await sendAndConfirm(transaction, { commitment: 'confirmed' });
  const signature = getSignatureFromTransaction(transaction);
  console.log(`  ${label}: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  return signature;
}

async function usdc(account: Address): Promise<bigint> {
  const { value } = await rpc.getTokenAccountBalance(account, { commitment: 'confirmed' }).send();
  return BigInt(value.amount);
}

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

// --- setup -----------------------------------------------------------------------------
const settings = await fetchVaultSettings(rpc, programs);
const [walletUsdc] = await findAssociatedTokenPda({
  owner: wallet.address,
  mint: settings.underlyingMint,
  tokenProgram: TOKEN_PROGRAM_ADDRESS,
});
const usdcBefore = await usdc(walletUsdc);
console.log(`wallet ${wallet.address}, USDC ${usdcBefore}, paying ${amount}`);
if (usdcBefore < amount) throw new Error('Not enough devnet USDC');

let master: Uint8Array;
if (existsSync(seedFile)) {
  master = new Uint8Array(Buffer.from(JSON.parse(readFileSync(seedFile, 'utf8')).master, 'hex'));
  console.log('reusing master seed from', seedFile);
} else {
  master = new Uint8Array(randomBytes(32));
  writeFileSync(seedFile, JSON.stringify({ master: Buffer.from(master).toString('hex') }), { mode: 0o600 });
  console.log('wrote new master seed to', seedFile);
}
const keys = deriveMetaKeysFromMasterSeed(master);

// --- 1. register -----------------------------------------------------------------------
console.log(`\n1. register @${handle}`);
let meta = await fetchMetaAddress(rpc, handle, programs);
if (meta) {
  check(meta.owner === wallet.address, 'handle already exists and belongs to this wallet');
  check(Buffer.compare(Buffer.from(meta.scanPubkey), Buffer.from(keys.scanPubkey)) === 0, 'handle uses the seed file keys');
} else {
  await send('register_handle', [await getRegisterHandleInstruction({ owner: wallet, name: handle, meta: keys, programs })]);
  meta = await fetchMetaAddress(rpc, handle, programs);
  check(meta !== null && meta.owner === wallet.address, 'handle readable from chain');
}

// --- 2. pay ----------------------------------------------------------------------------
console.log('\n2. pay');
const pay = await getPayToMetaAddressInstructions({
  payer: wallet,
  meta: meta!,
  mint: settings.underlyingMint,
  decimals: 6,
  amount,
  programs,
});
const paySignature = await send('pay + announce', pay.instructions);
check((await usdc(pay.stealthTokenAccount)) === amount, 'USDC sits at the one-time address');
check(pay.payment.stealthAddress !== wallet.address, 'one-time address is unrelated to the recipient wallet');

// --- 3. scan ---------------------------------------------------------------------------
console.log('\n3. scan');
let found = null;
for (let attempt = 1; attempt <= 6 && !found; attempt++) {
  const scan = await scanForPayments(rpc, {
    scanSeed: keys.scanSeed,
    spendPubkey: keys.spendPubkey,
    vault: settings,
    programs,
    maxSignatures: 200,
  });
  found = scan.payments.find((payment) => payment.signature === paySignature) ?? null;
  if (!found) {
    console.log(`  not indexed yet (attempt ${attempt}), waiting`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}
check(found !== null, 'scanner found the payment from chain data only');
check(found!.amount === amount && found!.tokenAccount === pay.stealthTokenAccount, 'amount and token account match');

// --- 4. sweep --------------------------------------------------------------------------
console.log('\n4. sweep into vault (wallet acts as relayer)');
const { instruction: createWrapped, wrappedTokenAccount } = await getCreateWrappedTokenAccountInstruction({
  payer: wallet,
  owner: wallet.address,
  vault: settings,
});
const stealthSigner = createStealthSigner(deriveStealthScalar(keys.spendSeed, found!.tweak));
const fee = (amount * BigInt(settings.feeBps)) / 10_000n;
await send('create wrapper ATA + deposit + close', [
  createWrapped,
  ...(await getSweepToVaultInstructions({
    stealthSigner,
    vault: settings,
    destination: wrappedTokenAccount,
    amount: found!.amount,
    rentRecipient: wallet.address,
  })),
]);
check((await usdc(wrappedTokenAccount)) === amount - fee, `wrapper balance is amount minus ${settings.feeBps} bps fee`);
const after = await scanForPayments(rpc, { scanSeed: keys.scanSeed, spendPubkey: keys.spendPubkey, vault: settings, programs, maxSignatures: 200 });
check(!after.payments.some((payment) => payment.signature === paySignature), 'swept payment no longer pending');

// --- 5. withdraw -----------------------------------------------------------------------
console.log('\n5. withdraw');
await send('withdraw', [await getWithdrawFromVaultInstruction({ owner: wallet, vault: settings, amount: amount - fee })]);
check((await usdc(wrappedTokenAccount)) === 0n, 'wrapper balance is zero');

console.log('\nsummary');
console.log('  vault balance now', await usdc(settings.vault));
console.log('  wallet USDC', usdcBefore, '→', await usdc(walletUsdc), '(treasury is the same account, so the fee returns to it)');
console.log('\nSMOKE TEST PASSED');
