/**
 * Stealth addresses on ed25519 (dual-key scheme, ERC-5564 style).
 * Spec and test-vector notes: docs/stealth-address-spec.md. Built only on audited
 * primitives (@noble/curves ed25519, @noble/hashes sha2); do not change the domain
 * separators or derivation without bumping the version tag and the spec.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToNumberLE, numberToBytesLE } from '@noble/curves/utils.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getAddressDecoder, getAddressEncoder, type Address } from '@solana/kit';

const Point = ed25519.Point;
type EdPoint = InstanceType<typeof Point>;
const ORDER = Point.Fn.ORDER;

const SHARED_SECRET_TAG = utf8ToBytes('opaq/stealth/v1/shared-secret');
const VIEW_TAG_TAG = utf8ToBytes('opaq/stealth/v1/view-tag');

/** Public half of a recipient's meta-address, as stored in `opaq_registry`. */
export type MetaAddress = {
  scanPubkey: Uint8Array;
  spendPubkey: Uint8Array;
};

/** Recipient secrets. Seeds are standard 32-byte ed25519 secret keys. */
export type MetaKeys = MetaAddress & {
  scanSeed: Uint8Array;
  spendSeed: Uint8Array;
};

/** What the payer derives for one payment; `ephemeralPubkey` and `viewTag` go into `announce`. */
export type StealthPayment = {
  stealthAddress: Address;
  ephemeralPubkey: Uint8Array;
  viewTag: number;
};

export type Announcement = {
  ephemeralPubkey: Uint8Array;
  stealthAddress: Address;
  viewTag: number;
};

function scalarFromSeed(seed: Uint8Array): bigint {
  if (seed.length !== 32) throw new Error('Seed must be 32 bytes');
  return ed25519.utils.getExtendedPublicKey(seed).scalar;
}

/** Decodes a public key and rejects identity, small-order and non-canonical points. */
function decodePoint(bytes: Uint8Array, label: string): EdPoint {
  if (bytes.length !== 32) throw new Error(`${label} must be 32 bytes`);
  const point = Point.fromBytes(bytes);
  if (point.is0() || !point.isTorsionFree()) throw new Error(`${label} is not a valid public key`);
  return point;
}

function hashToScalar(...parts: Uint8Array[]): bigint {
  const scalar = bytesToNumberLE(sha512(concatBytes(...parts))) % ORDER;
  if (scalar === 0n) throw new Error('Derived scalar is zero');
  return scalar;
}

function deriveFromShared(shared: EdPoint, spendPubkey: EdPoint) {
  const sharedBytes = shared.toBytes();
  const tweak = hashToScalar(SHARED_SECRET_TAG, sharedBytes);
  const viewTag = sha256(concatBytes(VIEW_TAG_TAG, sharedBytes))[0]!;
  const stealthPoint = spendPubkey.add(Point.BASE.multiply(tweak));
  return { tweak, viewTag, stealthPoint };
}

function pointToAddress(point: EdPoint): Address {
  return getAddressDecoder().decode(point.toBytes());
}

/** Generates a fresh meta-address. Callers persist the seeds; only public keys go on-chain. */
export function generateMetaKeys(): MetaKeys {
  return metaKeysFromSeeds(randomBytes(32), randomBytes(32));
}

export function metaKeysFromSeeds(scanSeed: Uint8Array, spendSeed: Uint8Array): MetaKeys {
  return {
    scanSeed,
    spendSeed,
    scanPubkey: ed25519.getPublicKey(scanSeed),
    spendPubkey: ed25519.getPublicKey(spendSeed),
  };
}

/**
 * Payer side: derives a one-time address for the recipient. `ephemeralSeed` is only
 * for deterministic tests; production callers must omit it.
 */
export function deriveStealthPayment(meta: MetaAddress, ephemeralSeed: Uint8Array = randomBytes(32)): StealthPayment {
  const scan = decodePoint(meta.scanPubkey, 'scanPubkey');
  const spend = decodePoint(meta.spendPubkey, 'spendPubkey');
  const ephemeralScalar = scalarFromSeed(ephemeralSeed);
  const { viewTag, stealthPoint } = deriveFromShared(scan.multiply(ephemeralScalar), spend);
  return {
    stealthAddress: pointToAddress(stealthPoint),
    ephemeralPubkey: Point.BASE.multiply(ephemeralScalar).toBytes(),
    viewTag,
  };
}

/**
 * Recipient side, needs only the scan seed and the public spend key, so it can run on a
 * merchant server without spend authority. Returns the payment tweak when it matches.
 */
export function scanAnnouncement(
  scanSeed: Uint8Array,
  spendPubkey: Uint8Array,
  announcement: Announcement,
): { tweak: bigint } | null {
  let ephemeral: EdPoint;
  try {
    ephemeral = decodePoint(announcement.ephemeralPubkey, 'ephemeralPubkey');
  } catch {
    return null; // Announcements are untrusted input.
  }
  const shared = ephemeral.multiply(scalarFromSeed(scanSeed));
  const { tweak, viewTag, stealthPoint } = deriveFromShared(shared, decodePoint(spendPubkey, 'spendPubkey'));
  if (viewTag !== announcement.viewTag) return null;
  return pointToAddress(stealthPoint) === announcement.stealthAddress ? { tweak } : null;
}

/** Recipient side, needs the spend seed: the private scalar controlling the stealth address. */
export function deriveStealthScalar(spendSeed: Uint8Array, tweak: bigint): bigint {
  return (scalarFromSeed(spendSeed) + tweak) % ORDER;
}

export function addressFromScalar(scalar: bigint): Address {
  return pointToAddress(Point.BASE.multiply(scalar));
}

/**
 * Standard ed25519 signature (RFC 8032 verification) from a raw scalar instead of a seed.
 * The nonce is derived deterministically from the scalar and the message.
 */
export function signWithScalar(scalar: bigint, message: Uint8Array): Uint8Array {
  if (scalar <= 0n || scalar >= ORDER) throw new Error('Scalar out of range');
  const scalarBytes = numberToBytesLE(scalar, 32);
  const publicKey = Point.BASE.multiply(scalar).toBytes();
  const prefix = sha512(concatBytes(utf8ToBytes('opaq/stealth/v1/nonce-prefix'), scalarBytes)).subarray(0, 32);
  const nonce = bytesToNumberLE(sha512(concatBytes(prefix, message))) % ORDER;
  const r = Point.BASE.multiply(nonce).toBytes();
  const challenge = bytesToNumberLE(sha512(concatBytes(r, publicKey, message))) % ORDER;
  const s = (nonce + challenge * scalar) % ORDER;
  return concatBytes(r, numberToBytesLE(s, 32));
}

export function verifySignature(signature: Uint8Array, message: Uint8Array, address: Address): boolean {
  return ed25519.verify(signature, message, new Uint8Array(getAddressEncoder().encode(address)));
}
