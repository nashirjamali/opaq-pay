import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { deriveStealthConfidentialKeys, deriveStealthConfidentialKeySeeds } from '../src/confidential.js';

const SCAN_SEED = new Uint8Array(32).map((_, i) => i + 1);
const STEALTH = address('9KwtkCZG7gBoCCVhZ3TKCWbiFcvTDnK87xGthhFAsRWh');
const OTHER = address('8ffWNato4YMJdSwu3To29AkYg96gFYNaBPKpxa8T1Wp4');

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('stealth confidential keys', () => {
  it('matches the vector computed independently (RFC 5869 HKDF in Python)', () => {
    const seeds = deriveStealthConfidentialKeySeeds(SCAN_SEED, STEALTH);
    expect(hex(seeds.elgamalSeed)).toBe('a6490f14724c7bb04e1d3fd77b55f69b46ae71202462ba47b17c2e21cd5ea312');
    expect(hex(seeds.aeSeed)).toBe('bcdba273a2b043eacf5c342fb76cd4d76b8e9dac7f83967dab4aa180a1fd70fc');
  });

  it('gives every stealth address its own keys and never reuses the scan seed', () => {
    const a = deriveStealthConfidentialKeySeeds(SCAN_SEED, STEALTH);
    const b = deriveStealthConfidentialKeySeeds(SCAN_SEED, OTHER);
    expect(hex(a.elgamalSeed)).not.toBe(hex(b.elgamalSeed));
    expect(hex(a.elgamalSeed)).not.toBe(hex(a.aeSeed));
    expect(hex(a.elgamalSeed)).not.toBe(hex(SCAN_SEED));
    expect(() => deriveStealthConfidentialKeySeeds(new Uint8Array(31), STEALTH)).toThrow();
  });

  it('builds deterministic zk-sdk keys that round-trip an amount', () => {
    const first = deriveStealthConfidentialKeys(SCAN_SEED, STEALTH);
    const again = deriveStealthConfidentialKeys(SCAN_SEED, STEALTH);
    expect(hex(first.elgamalKeypair.pubkey().toBytes())).toBe(hex(again.elgamalKeypair.pubkey().toBytes()));
    expect(again.aesKey.decrypt(first.aesKey.encrypt(199_000n))).toBe(199_000n);
    const ciphertext = first.elgamalKeypair.pubkey().encryptU64(42n);
    expect(again.elgamalKeypair.secret().decrypt(ciphertext)).toBe(42n);
  });
});
