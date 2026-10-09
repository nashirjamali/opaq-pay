import { ed25519 } from '@noble/curves/ed25519.js';
import {
  appendTransactionMessageInstruction,
  blockhash,
  createTransactionMessage,
  getBase58Decoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  addressFromScalar,
  createStealthSigner,
  deriveStealthPayment,
  deriveStealthScalar,
  generateMetaKeys,
  metaKeysFromSeeds,
  registry,
  scanAnnouncement,
  signWithScalar,
  verifySignature,
} from '../src/index.js';

const seed = (byte: number) => new Uint8Array(32).fill(byte);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('stealth payments', () => {
  it('lets the recipient find and control a payment', () => {
    const recipient = generateMetaKeys();
    const payment = deriveStealthPayment(recipient);

    const match = scanAnnouncement(recipient.scanSeed, recipient.spendPubkey, payment);
    expect(match).not.toBeNull();

    const scalar = deriveStealthScalar(recipient.spendSeed, match!.tweak);
    expect(addressFromScalar(scalar)).toBe(payment.stealthAddress);
  });

  it('gives a fresh address for every payment to the same recipient', () => {
    const recipient = generateMetaKeys();
    const a = deriveStealthPayment(recipient);
    const b = deriveStealthPayment(recipient);
    expect(a.stealthAddress).not.toBe(b.stealthAddress);
    expect(hex(a.ephemeralPubkey)).not.toBe(hex(b.ephemeralPubkey));
  });

  it('does not match other recipients', () => {
    const recipient = generateMetaKeys();
    const other = generateMetaKeys();
    const payment = deriveStealthPayment(recipient);
    expect(scanAnnouncement(other.scanSeed, other.spendPubkey, payment)).toBeNull();
  });

  it('rejects announcements with a wrong view tag or address', () => {
    const recipient = generateMetaKeys();
    const payment = deriveStealthPayment(recipient);
    const wrongTag = { ...payment, viewTag: (payment.viewTag + 1) % 256 };
    expect(scanAnnouncement(recipient.scanSeed, recipient.spendPubkey, wrongTag)).toBeNull();
    const otherAddress = getBase58Decoder().decode(generateMetaKeys().scanPubkey) as Address;
    const wrongAddress = { ...payment, stealthAddress: otherAddress };
    expect(scanAnnouncement(recipient.scanSeed, recipient.spendPubkey, wrongAddress)).toBeNull();
  });

  it('ignores malformed ephemeral keys instead of throwing', () => {
    const recipient = generateMetaKeys();
    const payment = deriveStealthPayment(recipient);
    const identity = ed25519.Point.ZERO.toBytes();
    expect(scanAnnouncement(recipient.scanSeed, recipient.spendPubkey, { ...payment, ephemeralPubkey: identity })).toBeNull();
    expect(scanAnnouncement(recipient.scanSeed, recipient.spendPubkey, { ...payment, ephemeralPubkey: new Uint8Array(5) })).toBeNull();
  });

  it('refuses invalid meta-addresses', () => {
    const identity = ed25519.Point.ZERO.toBytes();
    const valid = generateMetaKeys();
    expect(() => deriveStealthPayment({ scanPubkey: identity, spendPubkey: valid.spendPubkey })).toThrow();
    expect(() => deriveStealthPayment({ scanPubkey: valid.scanPubkey, spendPubkey: new Uint8Array(31) })).toThrow();
  });
});

describe('signing with a stealth scalar', () => {
  const recipient = metaKeysFromSeeds(seed(1), seed(2));
  const payment = deriveStealthPayment(recipient, seed(3));
  const tweak = scanAnnouncement(recipient.scanSeed, recipient.spendPubkey, payment)!.tweak;
  const scalar = deriveStealthScalar(recipient.spendSeed, tweak);

  it('produces signatures that verify as standard ed25519', () => {
    const message = new TextEncoder().encode('opaq sweep');
    const signature = signWithScalar(scalar, message);
    expect(verifySignature(signature, message, payment.stealthAddress)).toBe(true);
    expect(verifySignature(signature, new TextEncoder().encode('tampered'), payment.stealthAddress)).toBe(false);
    expect(hex(signWithScalar(scalar, message))).toBe(hex(signature)); // deterministic
  });

  it('signs a Kit transaction as fee payer', async () => {
    const signer = createStealthSigner(scalar);
    expect(signer.address).toBe(payment.stealthAddress);

    const announce = registry.getAnnounceInstruction({
      announcer: signer,
      eventAuthority: '11111111111111111111111111111111' as Address,
      program: registry.OPAQ_REGISTRY_PROGRAM_ADDRESS,
      ephemeralPubkey: payment.ephemeralPubkey,
      stealthAddress: payment.stealthAddress,
      viewTag: payment.viewTag,
    });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash('EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k'), lastValidBlockHeight: 0n },
          m,
        ),
      (m) => appendTransactionMessageInstruction(announce, m),
    );
    const transaction = await signTransactionMessageWithSigners(message);
    const signature = transaction.signatures[signer.address]!;
    expect(verifySignature(signature, new Uint8Array(transaction.messageBytes), signer.address)).toBe(true);
  });
});

/**
 * Regression vector: fixed seeds must always produce these outputs. These values were
 * generated by this implementation, so they guard against accidental changes but are
 * not an independent reference. Keep in sync with docs/stealth-address-spec.md.
 */
describe('test vector v1', () => {
  it('matches the recorded outputs', () => {
    const recipient = metaKeysFromSeeds(seed(1), seed(2));
    const payment = deriveStealthPayment(recipient, seed(3));
    expect({
      scanPubkey: hex(recipient.scanPubkey),
      spendPubkey: hex(recipient.spendPubkey),
      ephemeralPubkey: hex(payment.ephemeralPubkey),
      stealthAddress: payment.stealthAddress,
      viewTag: payment.viewTag,
    }).toMatchInlineSnapshot(`
      {
        "ephemeralPubkey": "ed4928c628d1c2c6eae90338905995612959273a5c63f93636c14614ac8737d1",
        "scanPubkey": "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c",
        "spendPubkey": "8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394",
        "stealthAddress": "5Yh3JG3jY5Aj5prsBL6hhzmYpHhjc4kaX1um7NDciGEG",
        "viewTag": 148,
      }
    `);
  });
});
