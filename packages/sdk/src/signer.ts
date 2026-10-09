import type { SignatureBytes, SignatureDictionary, TransactionPartialSigner } from '@solana/kit';
import { addressFromScalar, signWithScalar } from './stealth.js';

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
