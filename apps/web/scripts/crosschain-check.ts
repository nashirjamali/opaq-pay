/**
 * Runs the web app's cross-chain payment code (`lib/opaq/crosschain.ts`) without a browser:
 * a real burn on a testnet EVM chain, delivered on Solana devnet through an Opaq server's
 * relayer, then found by a recipient's scan.
 *
 *   pnpm --filter @opaq/sdk build && pnpm --filter @opaq/server start    (devnet, with the relayer on)
 *   pnpm --filter @opaq/web check:crosschain
 *
 * Env: OPAQ_SERVER_URL (default http://localhost:8787), OPAQ_RPC_URL, OPAQ_CCTP_SOURCE (default arc),
 * OPAQ_CCTP_AMOUNT (base units, default 250000), OPAQ_EVM_KEYFILE (JSON with `privateKey`,
 * default ~/.config/test-wallets/evm-testnet.json). It spends real testnet USDC.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ChainId } from "@opaq/sdk";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const sourceId = (process.env.OPAQ_CCTP_SOURCE ?? "arc") as ChainId;
// The web modules read their configuration when they are first imported.
process.env.NEXT_PUBLIC_OPAQ_CLUSTER = "devnet";
process.env.NEXT_PUBLIC_RPC_URL = process.env.OPAQ_RPC_URL ?? "https://api.devnet.solana.com";
process.env.NEXT_PUBLIC_OPAQ_SERVER_URL = process.env.OPAQ_SERVER_URL ?? "http://localhost:8787";
process.env.NEXT_PUBLIC_OPAQ_ENABLED_CHAINS = `solana,${sourceId}`;

const sdk = await import("@opaq/sdk");
const { EVM_SOURCES } = await import("../lib/chains");
const { evmChain } = await import("../lib/evm/chain");
const { getVault, rpc } = await import("../lib/opaq/chain");
const { config } = await import("../lib/opaq/env");
const { finishCrossChainPayment, payFromEvm } = await import("../lib/opaq/crosschain");

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}

const source = EVM_SOURCES.find((s) => s.chain === sourceId);
if (!source) throw new Error(`"${sourceId}" is not a chain this configuration can pay from`);
const amount = BigInt(process.env.OPAQ_CCTP_AMOUNT ?? 250_000);
const keyfile = process.env.OPAQ_EVM_KEYFILE ?? `${homedir()}/.config/test-wallets/evm-testnet.json`;
const account = privateKeyToAccount(JSON.parse(readFileSync(keyfile, "utf8")).privateKey as Hex);
const chain = evmChain(source);
const walletClient = createWalletClient({ account, chain, transport: http() });
const publicClient = createPublicClient({ chain, transport: http() });

const vault = await getVault();
// A recipient nobody else knows: the scan below can only find what this run announced.
const recipient = sdk.generateMetaKeys();
const scan = async () =>
  (
    await sdk.scanForPayments(rpc, {
      scanSeed: recipient.scanSeed,
      spendPubkey: recipient.spendPubkey,
      vault,
      programs: config.programs,
      includeSwept: true,
      maxSignatures: 200,
      commitment: "confirmed",
    })
  ).payments;

console.log(`1. pay ${amount} USDC base units from ${source.name} (${account.address})`);
const phases: string[] = [];
let pending: Parameters<typeof finishCrossChainPayment>[0]["pending"] | undefined;
let announcedBeforeBurn = false;
const started = Date.now();
const result = await payFromEvm({
  source,
  handle: "crosschain_check",
  meta: recipient,
  vault,
  amount,
  walletClient,
  publicClient,
  onProgress: (phase) => {
    if (phases.at(-1) !== phase) phases.push(phase);
  },
  onPending: (p) => {
    pending = p;
    // The recipient must be able to find the one-time address before the money has left.
    void scan().then((found) => (announcedBeforeBurn = found.some((f) => f.tokenAccount === p.stealthTokenAccount && f.tokenAccountExists)));
  },
});
console.log(`  steps: ${phases.join(" → ")} (${Math.round((Date.now() - started) / 1000)} s)`);
console.log(`  burn: ${source.explorerUrl}/tx/${result.burnTx}`);
console.log(`  mint: https://explorer.solana.com/tx/${result.mintSignature}?cluster=devnet`);
check(pending !== undefined && pending.burnTx === result.burnTx, "the burn was handed back for safekeeping as soon as it was sent");
check(result.mintSignature !== null, "the relayer delivered the USDC on Solana");
check(result.received > 0n && result.received <= amount, `the recipient received ${result.received} of ${amount}`);

console.log("2. the recipient scans");
const found = (await scan()).find((p) => p.tokenAccount === pending!.stealthTokenAccount);
check(found !== undefined, "the scan finds the payment from the relayed announcement");
check(found!.amount === result.received, `it holds ${result.received} USDC base units, waiting to be moved`);
check(announcedBeforeBurn, "it was already findable when the burn was sent");

console.log("3. finishing again");
const again = await finishCrossChainPayment({ source, vault, pending: pending!, onProgress: () => {} });
check(again.mintSignature === null && again.received === result.received, "a second finish sends nothing: the message is already delivered");

console.log("\nCROSS-CHAIN CHECK PASSED");
process.exit(0);
