/**
 * Runs the web app's own payment code (`apps/web/lib/opaq`) without a browser, against the local
 * dev stack: one payment is moved to the private balance, a second one is left where it arrived,
 * then everything is cashed out to a fresh address through the real relayer.
 *
 *   pnpm --filter @opaq/integration-tests dev-net     (in another terminal, after `anchor build`)
 *   pnpm --filter @opaq/web check:cashout
 *
 * It covers what the browser cannot be asserted on: the relay policy accepts every cash-out
 * transaction, the amounts add up, and a second run has nothing left to do.
 */
import { generateKeyPairSigner, type Address } from "@solana/kit";

const RPC = process.env.DEV_NET_URL ?? "http://localhost:8899";
// The web modules read their configuration when they are first imported.
process.env.NEXT_PUBLIC_OPAQ_CLUSTER = "localnet";
process.env.NEXT_PUBLIC_RPC_URL = RPC;
process.env.NEXT_PUBLIC_OPAQ_SERVER_URL = process.env.DEV_SERVER_URL ?? "http://localhost:8788";

const sdk = await import("@opaq/sdk");
const { rpc, sendInstructions, getVault } = await import("../lib/opaq/chain");
const { loadPayments } = await import("../lib/opaq/payments");
const { movePaymentsToPrivate } = await import("../lib/opaq/shield");
const { cashOutPayments } = await import("../lib/opaq/cashout");

function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`CHECK FAILED: ${message}`);
  console.log(`  ok: ${message}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const value = await read();
    if (done(value)) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function usdcBalance(owner: Address, mint: Address): Promise<bigint> {
  const { value } = await rpc.getTokenAccountsByOwner(owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }).send();
  return value.reduce((sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount), 0n);
}

const wallet = await generateKeyPairSigner();
const faucet = await fetch(`${RPC}/faucet`, { method: "POST", body: JSON.stringify({ address: wallet.address, sol: 2, usdc: 100 }) });
if (!faucet.ok) throw new Error(`Dev net faucet failed (${faucet.status}). Is dev-net running on ${RPC}?`);

const vault = await getVault();
const programs = sdk.LOCALNET_PROGRAMS;
const keys = sdk.generateMetaKeys();
const handle = `co_${Date.now().toString(36)}`;
const pay = async (amount: bigint) =>
  sendInstructions(
    (await sdk.getPayToMetaAddressInstructions({ payer: wallet, meta: keys, mint: vault.underlyingMint, decimals: vault.decimals, amount, programs }))
      .instructions,
    wallet,
  );

console.log(`1. @${handle} gets two payments`);
await sendInstructions([await sdk.getRegisterHandleInstruction({ owner: wallet, name: handle, meta: keys, programs })], wallet);
await pay(30_000_000n);
await pay(12_500_000n);
let loaded = await until(() => loadPayments(keys), (l) => l.held.length === 2, "both payments to be found");
check(loaded.unsweptTotal === 42.5 && loaded.balance === 0, "both show as arrived and not yet private: 42.50");

console.log("2. the first one moves to the private balance");
const first = loaded.movable.find((p) => p.amount === 30_000_000n)!;
await movePaymentsToPrivate({ keys, payments: [first], onProgress: () => {} });
loaded = await until(() => loadPayments(keys), (l) => l.balance > 0, "the private balance");
check(loaded.balance === 29.85, "private balance is 29.85 (30 minus 0.5%)");
check(loaded.held.length === 2 && loaded.unsweptTotal === 12.5, "the second payment still waits with 12.50");

console.log("3. cash out everything to a fresh address");
const recipient = (await generateKeyPairSigner()).address;
const phases: string[] = [];
const sent = await cashOutPayments({ keys, payments: loaded.held, recipient, onProgress: (p) => phases.push(`${p.current}:${p.phase}`) });
console.log(`  steps: ${phases.join(" ")}`);
check(sent === 42.2875, "reported 42.2875 sent (29.85 + 12.50 minus 0.5%)");
check((await until(() => usdcBalance(recipient, vault.underlyingMint), (b) => b > 0n, "the USDC to arrive")) === 42_287_500n, "the recipient holds exactly 42.2875 USDC");
check(phases.includes("1:unshield") || phases.includes("2:unshield"), "the private payment was unshielded first");
check(phases.filter((p) => p.endsWith(":sweep")).length === 1, "only the payment that had not been swept was swept");

console.log("4. afterwards");
loaded = await until(() => loadPayments(keys), (l) => l.held.length === 0, "the payments to show as cashed out");
check(loaded.payments.length === 2 && loaded.payments.every((p) => p.status === "out"), "both payments show as cashed out");
check(loaded.balance === 0 && loaded.movable.length === 0, "nothing is left to move or cash out");
check((await cashOutPayments({ keys, payments: loaded.held, recipient, onProgress: () => {} })) === 0, "a second cash out sends nothing");

console.log("\nWEB CASH OUT CHECK PASSED");
process.exit(0);
