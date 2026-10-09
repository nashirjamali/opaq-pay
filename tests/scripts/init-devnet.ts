/**
 * One-time setup of the shared `opaq_vault` on devnet: creates the wrapper mint (Token-2022 +
 * Confidential Transfer, config PDA as mint authority) and the treasury account, then calls
 * `init_config`. Only the vault program's upgrade authority can run it (programs built from
 * this repo; the deployment from before that change accepted any signer), and only once.
 *
 *   npx tsx scripts/init-devnet.ts            # prints the plan, sends nothing
 *   npx tsx scripts/init-devnet.ts --yes      # sends the transactions
 *
 * Env: OPAQ_RPC_URL (default devnet), OPAQ_KEYPAIR (default ~/.config/solana/id.json),
 *      OPAQ_USDC_MINT (default Circle devnet USDC), OPAQ_FEE_BPS (default 50),
 *      OPAQ_TREASURY_OWNER (address owning the fee account; default the admin wallet. Prefer a
 *      dedicated address: deposits whose source is the treasury account itself are rejected).
 * Program IDs come from the SDK's DEVNET_PROGRAMS unless OPAQ_*_PROGRAM_ID is set.
 */
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  extension,
  getInitializeMint2Instruction,
  getMintSize,
  getPreInitializeInstructionsForMintExtensions,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
} from '@solana/kit';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { configFromEnv, fetchVaultSettings, getInitVaultInstruction, vault } from '@opaq/sdk';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const CIRCLE_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const env = process.env;
const confirmed = process.argv.includes('--yes');
const rpcUrl = env.OPAQ_RPC_URL ?? 'https://api.devnet.solana.com';
const wsUrl = rpcUrl.replace(/^http/, 'ws');
const keypairPath = env.OPAQ_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const usdcMint = address(env.OPAQ_USDC_MINT ?? CIRCLE_DEVNET_USDC);
const feeBps = Number(env.OPAQ_FEE_BPS ?? 50);
const programs = configFromEnv({ ...env, OPAQ_CLUSTER: 'devnet' }).programs;

const rpc = createSolanaRpc(rpcUrl);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(wsUrl) });

if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 100) throw new Error('OPAQ_FEE_BPS must be 0-100');
const genesis = await rpc.getGenesisHash().send();
if (genesis !== DEVNET_GENESIS) throw new Error(`${rpcUrl} is not devnet (genesis ${genesis}). Refusing to continue.`);

const admin = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const [config] = await vault.findConfigPda({ programAddress: programs.vault });

const existing = await rpc.getAccountInfo(config, { encoding: 'base64' }).send();
if (existing.value) {
  console.log('Vault config already exists on devnet; nothing to do.');
  console.log(await fetchVaultSettings(rpc, programs));
  process.exit(0);
}

const mint = await fetchMint(rpc, usdcMint);
const decimals = mint.data.decimals;
const treasuryOwner = env.OPAQ_TREASURY_OWNER ? address(env.OPAQ_TREASURY_OWNER) : admin.address;
const [treasury] = await findAssociatedTokenPda({ owner: treasuryOwner, mint: usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
const balance = (await rpc.getBalance(admin.address).send()).value;

console.log('Plan');
console.log('  vault program   ', programs.vault);
console.log('  admin (you)     ', admin.address, `(${Number(balance) / 1e9} SOL)`);
console.log('  underlying mint ', usdcMint, `(${decimals} decimals)`);
console.log('  treasury ATA    ', treasury, `(owner ${treasuryOwner}${treasuryOwner === admin.address ? ', the admin wallet' : ''})`);
console.log('  config PDA      ', config);
console.log('  fee             ', `${feeBps} bps`);
if (!confirmed) {
  console.log('\nDry run. Re-run with --yes to send. This makes you the vault admin (transferable via propose/accept).');
  process.exit(0);
}
if (balance < 50_000_000n) throw new Error('Need at least 0.05 devnet SOL (solana airdrop 1 --url devnet)');

async function send(instructions: Instruction[]) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(admin, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(transaction);
  await sendAndConfirm(transaction, { commitment: 'confirmed' });
  return getSignatureFromTransaction(transaction);
}

const wrappedMint = await generateKeyPairSigner();
// Locked confidential settings (required by init_config): no authority, no auditor.
const confidential = extension('ConfidentialTransferMint', {
  authority: null,
  autoApproveNewAccounts: true,
  auditorElgamalPubkey: null,
});
const space = getMintSize([confidential]);
const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();

console.log('\n1/2 treasury account + wrapper mint');
console.log(
  '   ',
  await send([
    getCreateAssociatedTokenIdempotentInstruction({
      payer: admin,
      ata: treasury,
      owner: treasuryOwner,
      mint: usdcMint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
    getCreateAccountInstruction({
      payer: admin,
      newAccount: wrappedMint,
      lamports,
      space,
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(wrappedMint.address, [confidential]),
    getInitializeMint2Instruction({ mint: wrappedMint.address, decimals, mintAuthority: config, freezeAuthority: null }),
  ]),
);

console.log('2/2 init_config');
console.log(
  '   ',
  await send([
    await getInitVaultInstruction({
      admin,
      underlyingMint: usdcMint,
      wrappedMint: wrappedMint.address,
      treasury,
      underlyingTokenProgram: TOKEN_PROGRAM_ADDRESS,
      feeBps,
      programs,
    }),
  ]),
);

console.log('\nDone. Vault settings as the SDK reads them:');
console.log(await fetchVaultSettings(rpc, programs));
