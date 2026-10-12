import type { SolanaSignMessageFeature, SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature } from "@wallet-standard/features";

export interface PrivySigner {
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (transaction: Uint8Array, chain: string) => Promise<Uint8Array>;
}

const ICON =
  "data:image/svg+xml;base64," +
  btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#111"/></svg>');

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function publicKeyOf(address: string): Uint8Array {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of address) n = n * 58n + BigInt(alphabet.indexOf(ch));
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}

/**
 * Presents a Privy embedded wallet as a Wallet Standard wallet, so the sign-in, handle registration
 * and signing code treats it like Phantom. Nothing downstream knows the difference.
 */
export function createPrivyWallet(signer: PrivySigner): Wallet {
  const account: WalletAccount = {
    address: signer.address,
    publicKey: publicKeyOf(signer.address),
    chains: ["solana:devnet", "solana:localnet", "solana:mainnet"],
    features: ["solana:signMessage", "solana:signTransaction"],
  };
  const features: StandardConnectFeature & SolanaSignMessageFeature & SolanaSignTransactionFeature = {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => ({ accounts: [account] }),
    },
    "solana:signMessage": {
      version: "1.1.0",
      signMessage: async (...inputs) =>
        Promise.all(
          inputs.map(async ({ message }) => {
            // The account's private keys come from this signature, so it must be the same every time:
            // ed25519 is deterministic by design. Check anyway, because a signer that is not would
            // hand out different keys on every sign-in and lock the person out of their payments.
            const first = await signer.signMessage(message);
            const second = await signer.signMessage(message);
            if (!sameBytes(first, second)) {
              throw new Error("This wallet signs the same message differently each time, so it cannot derive stable keys.");
            }
            return { signedMessage: message, signature: first };
          }),
        ),
    },
    "solana:signTransaction": {
      version: "1.0.0",
      supportedTransactionVersions: ["legacy", 0],
      signTransaction: async (...inputs) =>
        Promise.all(
          inputs.map(async ({ transaction, chain }) => ({
            signedTransaction: await signer.signTransaction(transaction, chain ?? "solana:devnet"),
          })),
        ),
    },
  };
  return { version: "1.0.0", name: "Google", icon: ICON as never, chains: account.chains, features, accounts: [account] };
}
