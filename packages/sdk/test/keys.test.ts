import { randomBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  decodeViewingKey,
  deriveMetaKeysFromMasterSeed,
  deriveMetaKeysFromSignature,
  deriveStealthPayment,
  encodeViewingKey,
  findOwnPayments,
} from '../src/index.js';

const MASTER = new Uint8Array(32).map((_, i) => i + 1);

describe('master seed derivation', () => {
  it('is deterministic and separates scan from spend and accounts from each other', () => {
    const a = deriveMetaKeysFromMasterSeed(MASTER);
    const b = deriveMetaKeysFromMasterSeed(MASTER);
    expect([...a.scanSeed]).toEqual([...b.scanSeed]);
    expect([...a.spendPubkey]).toEqual([...b.spendPubkey]);
    expect([...a.scanSeed]).not.toEqual([...a.spendSeed]);
    expect([...deriveMetaKeysFromMasterSeed(MASTER, 1).scanSeed]).not.toEqual([...a.scanSeed]);
    expect([...deriveMetaKeysFromMasterSeed(randomBytes(32)).scanSeed]).not.toEqual([...a.scanSeed]);
  });

  it('matches the recorded vector', () => {
    const keys = deriveMetaKeysFromMasterSeed(MASTER);
    expect(Buffer.from(keys.scanSeed).toString('hex')).toBe(VECTOR.scanSeed);
    expect(Buffer.from(keys.spendSeed).toString('hex')).toBe(VECTOR.spendSeed);
  });

  it('rejects weak inputs', () => {
    expect(() => deriveMetaKeysFromMasterSeed(new Uint8Array(31))).toThrow();
    expect(() => deriveMetaKeysFromMasterSeed(MASTER, -1)).toThrow();
    expect(() => deriveMetaKeysFromSignature(new Uint8Array(63))).toThrow();
    expect(deriveMetaKeysFromSignature(randomBytes(64)).scanPubkey).toHaveLength(32);
  });
});

describe('viewing key', () => {
  it('round-trips and is enough to scan, but carries no spend seed', () => {
    const keys = deriveMetaKeysFromMasterSeed(MASTER);
    const encoded = encodeViewingKey(keys);
    expect(encoded.startsWith('opaqvk1')).toBe(true);
    expect(encoded).not.toContain(Buffer.from(keys.spendSeed).toString('hex'));

    const viewing = decodeViewingKey(encoded);
    expect(Object.keys(viewing).sort()).toEqual(['scanSeed', 'spendPubkey']);
    const payment = deriveStealthPayment(keys);
    expect(findOwnPayments(viewing.scanSeed, viewing.spendPubkey, [payment])).toHaveLength(1);
  });

  it('refuses malformed input', () => {
    const encoded = encodeViewingKey(deriveMetaKeysFromMasterSeed(MASTER));
    expect(() => decodeViewingKey(encoded.slice(1))).toThrow();
    expect(() => decodeViewingKey('opaqvk1' + '0OIl')).toThrow(); // not base58
    expect(() => decodeViewingKey(encoded.slice(0, -4))).toThrow();
    expect(() => decodeViewingKey('')).toThrow();
  });
});

// Computed independently (HKDF-SHA256 per RFC 5869 with Python's hmac); a change here means
// every derived key changed.
const VECTOR = {
  scanSeed: '14b1b45474de62960720d619086d84dcf5695f6a7e2d129a93ec048ddd3e2e09',
  spendSeed: 'ab606be12960ce39b13ebaf9931f61a6069268451230598434343ecb68f3f82c',
};
