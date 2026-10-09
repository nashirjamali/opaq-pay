/**
 * Key management for recipients: one master secret gives every key a handle needs, and a
 * scan-only "viewing key" can be handed to an accountant or auditor.
 *
 * Only HKDF-SHA256 over an existing secret is used here; the stealth scheme itself lives in
 * `stealth.ts`. Domain strings are part of the format: changing them changes every derived key.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getBase58Decoder, getBase58Encoder } from '@solana/kit';
import { metaKeysFromSeeds, type MetaKeys } from './stealth.js';

const KDF_SALT = utf8ToBytes('opaq/keys/v1');

/** Message a wallet signs to derive keys without a separate backup (see `deriveMetaKeysFromSignature`). */
export const KEY_DERIVATION_MESSAGE =
  'Opaq: create my private payment keys.\n\nOnly sign this message on the Opaq app. Anyone who sees the signature can read your payments and spend them.';

function expand(master: Uint8Array, label: string, account: number): Uint8Array {
  return hkdf(sha256, master, KDF_SALT, utf8ToBytes(`${label}/${account}`), 32);
}

/**
 * Derives the scan and spend seeds from one master secret (at least 32 bytes of entropy).
 * `account` lets one master serve several handles.
 */
export function deriveMetaKeysFromMasterSeed(master: Uint8Array, account = 0): MetaKeys {
  if (master.length < 32) throw new Error('Master seed must be at least 32 bytes');
  if (!Number.isInteger(account) || account < 0 || account > 0xffff_ffff) throw new Error('Invalid account index');
  return metaKeysFromSeeds(expand(master, 'scan', account), expand(master, 'spend', account));
}

/**
 * Derives keys from a wallet's signature over `KEY_DERIVATION_MESSAGE`. This relies on the
 * wallet signing deterministically (ed25519 does, but a wallet could still randomise or
 * change its signing); offer a recovery export as well and treat the signature as a secret.
 */
export function deriveMetaKeysFromSignature(signature: Uint8Array, account = 0): MetaKeys {
  if (signature.length !== 64) throw new Error('Signature must be 64 bytes');
  return deriveMetaKeysFromMasterSeed(signature, account);
}

// ---------------------------------------------------------------------------
// Viewing key (scan-only)
// ---------------------------------------------------------------------------

export type ViewingKey = {
  scanSeed: Uint8Array;
  spendPubkey: Uint8Array;
};

const VIEWING_KEY_PREFIX = 'opaqvk1';
const VIEWING_KEY_VERSION = 1;

/**
 * Exports a credential that lets its holder find and total this recipient's payments
 * (`scanForPayments`) but not spend them. It does not unlock confidential wrapper balances.
 */
export function encodeViewingKey(key: ViewingKey): string {
  if (key.scanSeed.length !== 32 || key.spendPubkey.length !== 32) throw new Error('Invalid viewing key');
  const bytes = concatBytes(new Uint8Array([VIEWING_KEY_VERSION]), key.scanSeed, key.spendPubkey);
  return VIEWING_KEY_PREFIX + getBase58Decoder().decode(bytes);
}

export function decodeViewingKey(encoded: string): ViewingKey {
  if (!encoded.startsWith(VIEWING_KEY_PREFIX)) throw new Error('Not an Opaq viewing key');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(getBase58Encoder().encode(encoded.slice(VIEWING_KEY_PREFIX.length)));
  } catch {
    throw new Error('Malformed viewing key');
  }
  if (bytes.length !== 65 || bytes[0] !== VIEWING_KEY_VERSION) throw new Error('Unsupported viewing key');
  return { scanSeed: bytes.slice(1, 33), spendPubkey: bytes.slice(33, 65) };
}
