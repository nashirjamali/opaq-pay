import type { SignatureBytes, SignatureDictionary, TransactionPartialSigner } from '@solana/kit';
import { addressFromScalar, generateScalar, signWithScalar } from './stealth.js';

/**
 * Kit signer for a stealth address, used to sign the sweep into `opaq_vault`.
 * The scalar never leaves this object; keep it on the recipient's device or server.
 */
export function createStealthSigner(scalar: bigint): TransactionPartialSigner {
  const address = addressFromScalar(scalar);
  return Object.freeze({
    address,
    async signTransactions(transactions) {
      return transactions.map(
        (transaction): SignatureDictionary => ({
          [address]: signWithScalar(scalar, new Uint8Array(transaction.messageBytes)) as SignatureBytes,
        }),
      );
    },
  });
}

/**
 * A signer with a random key that exists only for this call site. Use it where an instruction
 * needs some signer but nobody's identity: the relayer pays the fee, and this key holds nothing
 * and authorises nothing else (announcing for a payer on another chain, CCTP's `caller`).
 */
export function createThrowawaySigner(): TransactionPartialSigner {
  return createStealthSigner(generateScalar());
}
