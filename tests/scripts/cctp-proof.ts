/**
 * Proof that a payment can start on an EVM chain. USDC is burned on the source chain with
 * Circle CCTP V2 and minted on Solana devnet straight into a one-time stealth address; the
 * recipient's scanner then finds it and it is swept into the vault like any Solana payment.
 *
 *   register @handle (if needed) → derive stealth address → relayer creates its USDC account
 *   → approve + depositForBurn on the source chain → wait for Circle's attestation
 *   → relayer: receive_message (mint) → relayer: announce → scan → sweep
 *
 * Nothing in the programs changes: CCTP only replaces the payer's SPL transfer. The payer has no
 * Solana wallet, so the relayer creates the token account, submits the mint and announces.
 *
 *   OPAQ_SMOKE_DIR=/path/outside/repo npx tsx scripts/cctp-proof.ts [handle]
 *
 * State lives in OPAQ_SMOKE_DIR (`<handle>-seed.json`, `cctp-state.json`); rerunning resumes a
 * burn that has not been minted yet. Env: OPAQ_CCTP_SOURCE (`arc` default, or `base`),
 * OPAQ_CCTP_AMOUNT (base units, default 1000000), OPAQ_EVM_KEYFILE (JSON with `privateKey`,
 * default ~/.config/test-wallets/evm-testnet.json), OPAQ_RPC_URL, OPAQ_KEYPAIR.
 */
import { getTransferSolInstruction } from '@solana-program/system';
import {
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CCTP_DEVNET_SOURCES,
  CCTP_ERC20_ABI,
  CCTP_TOKEN_MESSENGER_ABI,
  configFromEnv,
  createStealthSigner,
  decodeCctpBurnMessage,
  deriveMetaKeysFromMasterSeed,
  deriveStealthScalar,
  fetchCctpTransferQuote,
  fetchMetaAddress,
  fetchVaultSettings,
  getCctpAnnounceInstruction,
  getCctpDepositForBurnArgs,
  getCctpReceiveMessageInstruction,
  getPrepareCctpPaymentInstructions,
  getRegisterHandleInstruction,
  getSweepToVaultInstructions,
  scanForPayments,
  waitForCctpAttestation,
  type ChainId,
  type HexString,
} from '@opaq/sdk';

const env = process.env;
const handle = process.argv[2] ?? 'opaq_cctp';
const amount = BigInt(env.OPAQ_CCTP_AMOUNT ?? 1_000_000);
const dir = env.OPAQ_SMOKE_DIR;
if (!dir) throw new Error('Set OPAQ_SMOKE_DIR to a directory outside the repo');
// The script reads the source table directly so an unproven chain (Base) can be tried before
// it is switched on in `CHAINS`; apps go through `getCctpSourceChain`, which enforces the flag.
const sourceName = (env.OPAQ_CCTP_SOURCE ?? 'arc') as ChainId;
const source = CCTP_DEVNET_SOURCES[sourceName];
if (!source) throw new Error(`OPAQ_CCTP_SOURCE must be one of ${Object.keys(CCTP_DEVNET_SOURCES).join(', ')}`);

const rpcUrl = env.OPAQ_RPC_URL ?? 'https://api.devnet.solana.com';
const rpc = createSolanaRpc(rpcUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions: createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, 'ws')),
});
const programs = configFromEnv({ ...env, OPAQ_CLUSTER: 'devnet' }).programs;
const solanaTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- local state -----------------------------------------------------------------------------
type Pending = {
  source: string;
  stealthAddress: string;
  stealthTokenAccount: string;
  mintRecipient: HexString;
  ephemeralPubkey: string;
  viewTag: number;
  amount: string;
  burnTx?: string;
  mintSignature?: string;
  announceSignature?: string;
};
type State = { relayerSeed?: string; pending?: Pending };
const statePath = join(dir, 'cctp-state.json');
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });

const seedPath = join(dir, `${handle}-seed.json`);
if (!existsSync(seedPath)) {
  writeFileSync(seedPath, JSON.stringify({ master: randomBytes(32).toString('hex') }), { mode: 0o600 });
}
const keys = deriveMetaKeysFromMasterSeed(new Uint8Array(Buffer.from(JSON.parse(readFileSync(seedPath, 'utf8')).master, 'hex')));

const wallet = await createKeyPairSignerFromBytes(
  new Uint8Array(JSON.parse(readFileSync(env.OPAQ_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, 'utf8'))),
);
state.relayerSeed ??= randomBytes(32).toString('hex');
save();
const relayer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(Buffer.from(state.relayerSeed, 'hex')));

const evmKeyfile = env.OPAQ_EVM_KEYFILE ?? `${homedir()}/.config/test-wallets/evm-testnet.json`;
const evmAccount = privateKeyToAccount(JSON.parse(readFileSync(evmKeyfile, 'utf8')).privateKey as Hex);
const chain = defineChain({
  id: source.evmChainId,
  name: source.name,
  nativeCurrency: source.nativeCurrency,
  rpcUrls: { default: { http: [source.rpcUrl] } },
});
const evm = createPublicClient({ chain, transport: http() });
const evmWallet = createWalletClient({ account: evmAccount, chain, transport: http() });

// --- Solana sending ----------------------------------------------------------------------------
const isRateLimited = (error: unknown) => /429|Too Many Requests/.test(String((error as Error)?.message ?? error));

/** The public devnet RPC rate-limits; back off and retry. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimited(error) || i >= attempts) throw error;
      await sleep(2000 * i);
    }
  }
}

async function send(label: string, instructions: Instruction[], feePayer: KeyPairSigner): Promise<Signature> {
  const { value: latestBlockhash } = await withRetry(() => rpc.getLatestBlockhash().send());
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(transaction);
  const signature = getSignatureFromTransaction(transaction);
  try {
    await withRetry(() => sendAndConfirm(transaction, { commitment: 'confirmed' }));
  } catch (error) {
    // A retry after a 429 can resend a transaction that already landed; its signature is fixed.
    if (!/already been processed/.test(String((error as Error)?.message))) throw error;
  }
  console.log(`  ${label}: ${solanaTx(signature)}`);
  return signature;
}

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

// --- 0. setup --------------------------------------------------------------------------------
const settings = await fetchVaultSettings(rpc, programs);
console.log(
  `source chain     ${source.name} (CCTP domain ${source.domain})\nEVM payer        ${evmAccount.address}\n` +
    `recipient wallet ${wallet.address}\nrelayer          ${relayer.address}`,
);

// The relayer should not be funded from the recipient's wallet (that links them); the faucet is
// tried first and the wallet is only used when explicitly allowed.
const relayerLamports = (await rpc.getBalance(relayer.address, { commitment: 'confirmed' }).send()).value;
if (relayerLamports < 30_000_000n) {
  console.log('\n0. fund the relayer');
  try {
    const signature = await rpc.requestAirdrop(relayer.address, lamports(1_000_000_000n)).send();
    for (let i = 0; i < 30; i++) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      if (value[0]?.confirmationStatus === 'confirmed' || value[0]?.confirmationStatus === 'finalized') break;
      await sleep(1000);
    }
    console.log('  airdropped 1 SOL from the devnet faucet');
  } catch (error) {
    if (env.OPAQ_SMOKE_ALLOW_WALLET_FUNDED_RELAYER !== '1') {
      throw new Error(
        `Faucet airdrop failed (${String(error).slice(0, 120)}). Fund ${relayer.address} from a wallet unrelated to the ` +
          'recipient, or set OPAQ_SMOKE_ALLOW_WALLET_FUNDED_RELAYER=1 to accept a linked relayer.',
      );
    }
    await send(
      'fund relayer from the recipient wallet (links them!)',
      [getTransferSolInstruction({ source: wallet, destination: relayer.address, amount: 60_000_000n })],
      wallet,
    );
  }
}

// --- 1. register -----------------------------------------------------------------------------
console.log(`\n1. @${handle}`);
let meta = await fetchMetaAddress(rpc, handle, programs);
if (!meta) {
  await send('register_handle', [await getRegisterHandleInstruction({ owner: wallet, name: handle, meta: keys, programs })], wallet);
  meta = await fetchMetaAddress(rpc, handle, programs);
}
check(meta?.owner === wallet.address, 'handle belongs to this wallet');
check(Buffer.compare(Buffer.from(meta!.scanPubkey), Buffer.from(keys.scanPubkey)) === 0, `handle uses the keys in ${seedPath}`);

// --- 2. one-time address -----------------------------------------------------------------------
console.log('\n2. one-time address for this payment');
if (!state.pending) {
  const prepared = await getPrepareCctpPaymentInstructions({ accountPayer: relayer, meta: meta!, mint: settings.underlyingMint });
  // Saved before anything is sent: the announcement needs the ephemeral key after the burn.
  state.pending = {
    source: sourceName,
    stealthAddress: prepared.payment.stealthAddress,
    stealthTokenAccount: prepared.stealthTokenAccount,
    mintRecipient: prepared.mintRecipient,
    ephemeralPubkey: Buffer.from(prepared.payment.ephemeralPubkey).toString('hex'),
    viewTag: prepared.payment.viewTag,
    amount: amount.toString(),
  };
  save();
} else {
  console.log('  resuming the pending payment');
  if (state.pending.source !== sourceName) throw new Error(`Pending payment is from ${state.pending.source}; finish it with that source`);
}
const pending = state.pending;
const stealthAddress = address(pending.stealthAddress);
const stealthUsdc = address(pending.stealthTokenAccount);
console.log(`  stealth address ${stealthAddress}\n  its USDC account ${stealthUsdc}`);
// CCTP can only mint into an account that already exists. Idempotent, so safe on a resumed run.
await send(
  'relayer creates the stealth USDC account',
  [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: relayer,
      ata: stealthUsdc,
      owner: stealthAddress,
      mint: settings.underlyingMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
  ],
  relayer,
);

// --- 3. burn on the source chain ---------------------------------------------------------------
console.log(`\n3. burn ${pending.amount} USDC base units on ${source.name}`);
const erc20Abi = parseAbi(CCTP_ERC20_ABI);
if (!pending.burnTx) {
  const burnAmount = BigInt(pending.amount);
  const [balance, allowance] = await Promise.all([
    evm.readContract({ address: source.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [evmAccount.address] }),
    evm.readContract({ address: source.usdc, abi: erc20Abi, functionName: 'allowance', args: [evmAccount.address, source.tokenMessenger] }),
  ]);
  check(balance >= burnAmount, `payer holds ${balance} USDC base units on ${source.name}`);
  if (allowance < burnAmount) {
    const approveTx = await evmWallet.writeContract({ address: source.usdc, abi: erc20Abi, functionName: 'approve', args: [source.tokenMessenger, burnAmount] });
    await evm.waitForTransactionReceipt({ hash: approveTx });
    console.log(`  approve: ${source.explorerUrl}/tx/${approveTx}`);
  }
  const quote = await fetchCctpTransferQuote(source, burnAmount);
  console.log(`  finality threshold ${quote.minFinalityThreshold}, max fee ${quote.maxFee}`);
  const burnTx = await evmWallet.writeContract({
    address: source.tokenMessenger,
    abi: parseAbi(CCTP_TOKEN_MESSENGER_ABI),
    functionName: 'depositForBurn',
    args: getCctpDepositForBurnArgs({ source, amount: burnAmount, mintRecipient: pending.mintRecipient, quote }),
  });
  pending.burnTx = burnTx;
  save();
  const receipt = await evm.waitForTransactionReceipt({ hash: burnTx });
  check(receipt.status === 'success', 'burn transaction succeeded');
}
console.log(`  burn: ${source.explorerUrl}/tx/${pending.burnTx}`);

// --- 4. attestation + mint on Solana -----------------------------------------------------------
console.log('\n4. Circle attestation, then mint on Solana (relayer pays)');
const before = BigInt((await rpc.getTokenAccountBalance(stealthUsdc, { commitment: 'confirmed' }).send()).value.amount);
if (!pending.mintSignature) {
  const started = Date.now();
  const attested = await waitForCctpAttestation(source, pending.burnTx!);
  console.log(`  attested after ${Math.round((Date.now() - started) / 1000)} s`);
  // The attestation API is untrusted: only deliver the message we are waiting for.
  const decoded = decodeCctpBurnMessage(attested.message);
  check(decoded.mintRecipient === stealthUsdc && decoded.sourceDomain === source.domain, 'attested message mints into this payment’s stealth account');
  pending.mintSignature = await send(
    'receive_message',
    [await getCctpReceiveMessageInstruction(rpc, { payer: relayer, ...attested, mint: settings.underlyingMint })],
    relayer,
  );
  save();
}
const minted = BigInt((await rpc.getTokenAccountBalance(stealthUsdc, { commitment: 'confirmed' }).send()).value.amount);
console.log(`  stealth USDC account: ${before} → ${minted}`);

// --- 5. announce -------------------------------------------------------------------------------
console.log('\n5. announce (relayer, on behalf of the EVM payer)');
if (!pending.announceSignature) {
  pending.announceSignature = await send(
    'announce',
    [
      await getCctpAnnounceInstruction({
        announcer: relayer,
        payment: { stealthAddress, ephemeralPubkey: new Uint8Array(Buffer.from(pending.ephemeralPubkey, 'hex')), viewTag: pending.viewTag },
        programs,
      }),
    ],
    relayer,
  );
  save();
}

// --- 6. scan -----------------------------------------------------------------------------------
console.log('\n6. scan with the recipient’s keys');
const scan = async () =>
  (await withRetry(() => scanForPayments(rpc, { scanSeed: keys.scanSeed, spendPubkey: keys.spendPubkey, vault: settings, programs, includeSwept: true, maxSignatures: 300 })))
    .payments.find((p) => p.stealthAddress === stealthAddress);
let payment = await scan();
for (let attempt = 1; attempt <= 20 && !payment; attempt++) {
  await sleep(4000);
  payment = await scan();
}
check(payment !== undefined, 'scanner found the cross-chain payment from chain data only');
console.log(`  waiting to be swept: ${payment!.amount}`);

// --- 7. sweep ----------------------------------------------------------------------------------
console.log('\n7. sweep into the stealth address’s own wrapper account (relayer pays)');
let sweepSignature: Signature | undefined;
if (payment!.amount > 0n) {
  const stealthSigner = createStealthSigner(deriveStealthScalar(keys.spendSeed, payment!.tweak));
  sweepSignature = await send(
    'create wrapper account + deposit + close USDC account',
    await getSweepToVaultInstructions({
      stealthSigner,
      vault: settings,
      amount: payment!.amount,
      rentRecipient: relayer.address,
      accountPayer: relayer,
    }),
    relayer,
  );
}
const swept = await scan();
const expected = minted - (minted * BigInt(settings.feeBps)) / 10_000n;
if (sweepSignature) check(swept?.wrappedPublicAmount === expected, `stealth wrapper account holds ${expected} (minted amount minus ${settings.feeBps} bps)`);

console.log(
  `\nCROSS-CHAIN PAYMENT PROVEN\n  burn on ${source.name}: ${source.explorerUrl}/tx/${pending.burnTx}\n` +
    `  mint on Solana devnet: ${solanaTx(pending.mintSignature!)}\n  announce: ${solanaTx(pending.announceSignature!)}` +
    (sweepSignature ? `\n  sweep into the vault: ${solanaTx(sweepSignature)}` : ''),
);
delete state.pending; // the next run makes a new payment
save();
