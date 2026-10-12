import { fetchVaultSettings, type VaultSettings } from "@opaq/sdk";
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { config, RPC_URL } from "./env";

const AIRDROP_LAMPORTS = 50_000_000;

export const rpc = createSolanaRpc(RPC_URL);

/** Enough for the rent of a new account (a handle or a one-time token account) plus the network fee. */
export const MIN_SOL_LAMPORTS = 3_000_000n;

export async function getSolBalance(address: Address): Promise<bigint> {
  const { value } = await rpc.getBalance(address, { commitment: "confirmed" }).send();
  return value;
}

let vaultPromise: Promise<VaultSettings> | null = null;

/** Vault settings (USDC mint, decimals, wrapper mint), read once and reused. A failed read is retried next time. */
export function getVault(): Promise<VaultSettings> {
  vaultPromise ??= fetchVaultSettings(rpc, config.programs).catch((error) => {
    vaultPromise = null;
    throw error;
  });
  return vaultPromise;
}

const CONFIRM_TIMEOUT_MS = 60_000;

/** Signs with `feePayer` (and any other signers inside the instructions), sends, and waits for confirmation. */
export async function sendInstructions(instructions: Instruction[], feePayer: TransactionSigner): Promise<Signature> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(transaction);
  const signature = getSignatureFromTransaction(transaction);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: "base64", preflightCommitment: "confirmed" })
    .send();

  // Poll instead of subscribing: it works against any RPC and survives dropped sockets.
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return signature;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The transaction was sent but not confirmed in time. Check your wallet before trying again.");
}

/**
 * Asks the devnet or local faucet for a little SOL, so a brand-new wallet (a Google sign-up has none)
 * can register its handle. Returns whether the balance reached `MIN_SOL_LAMPORTS`; the public devnet
 * faucet is rate limited, so a failure is normal and the caller falls back to telling the person.
 */
export async function requestTestSol(address: Address): Promise<boolean> {
  try {
    const response = await fetch(config.cluster === "localnet" ? RPC_URL.replace(/\/?$/, "/faucet") : RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body:
        config.cluster === "localnet"
          ? JSON.stringify({ address })
          : JSON.stringify({ jsonrpc: "2.0", id: 1, method: "requestAirdrop", params: [address, AIRDROP_LAMPORTS] }),
    });
    if (!response.ok) return false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await getSolBalance(address)) >= MIN_SOL_LAMPORTS) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch {
    /* faucet down or rate limited */
  }
  return false;
}
