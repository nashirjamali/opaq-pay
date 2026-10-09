import {
  deriveMetaKeysFromSignature,
  fetchMetaAddress,
  getRegisterHandleInstruction,
  KEY_DERIVATION_MESSAGE,
  type MetaKeys,
} from "@opaq/sdk";
import type { TransactionSigner } from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { signWalletMessage } from "../wallet/standard";
import { rpc, sendInstructions } from "./chain";
import { config } from "./env";

/**
 * Asks the wallet to sign the SDK's fixed message and derives the scan and spend keys from the
 * signature. The keys live in memory only: nothing is stored, and the same wallet gets the same
 * keys back on the next sign-in.
 */
export async function deriveKeys(wallet: Wallet, account: WalletAccount): Promise<MetaKeys> {
  const signature = await signWalletMessage(wallet, account, new TextEncoder().encode(KEY_DERIVATION_MESSAGE));
  return deriveMetaKeysFromSignature(signature);
}

export type HandleCheck = "available" | "mine" | "taken";

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** `mine` means the handle already points at these exact keys, so this wallet owns it. */
export async function checkHandle(name: string, keys: MetaKeys): Promise<HandleCheck> {
  const meta = await fetchMetaAddress(rpc, name, config.programs);
  if (!meta) return "available";
  return same(meta.scanPubkey, keys.scanPubkey) && same(meta.spendPubkey, keys.spendPubkey) ? "mine" : "taken";
}

/** Registers `name` on chain. The wallet pays the fee and rent and is recorded as the handle's owner. */
export async function registerHandle(owner: TransactionSigner, name: string, keys: MetaKeys): Promise<void> {
  const instruction = await getRegisterHandleInstruction({ owner, name, meta: keys, programs: config.programs });
  await sendInstructions([instruction], owner);
}

// The handle is public, so remembering it per wallet is only a convenience. It is always
// re-checked against the keys on chain before it is trusted.
const key = (address: string) => `opaq:handle:${address}`;

export function recallHandle(address: string): string | null {
  try {
    return localStorage.getItem(key(address));
  } catch {
    return null;
  }
}

export function rememberHandle(address: string, handle: string): void {
  try {
    localStorage.setItem(key(address), handle);
  } catch {
    /* storage can be blocked; the user can type the handle again */
  }
}
