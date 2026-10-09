import {
  getTransactionDecoder,
  getTransactionEncoder,
  type Address,
  type TransactionModifyingSigner,
} from "@solana/kit";
import type { SolanaSignMessageFeature, SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature } from "@wallet-standard/features";

/** Wallets the app can use: Solana wallets that connect, sign messages and sign transactions. */
export function listSolanaWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter(
      (w) =>
        w.chains.some((c) => c.startsWith("solana:")) &&
        "standard:connect" in w.features &&
        "solana:signMessage" in w.features &&
        "solana:signTransaction" in w.features,
    );
}

/** Calls `callback` when a wallet registers or unregisters. Returns the unsubscribe function. */
export function onWalletsChange(callback: () => void): () => void {
  const wallets = getWallets();
  const offRegister = wallets.on("register", callback);
  const offUnregister = wallets.on("unregister", callback);
  return () => {
    offRegister();
    offUnregister();
  };
}

export async function connectWallet(wallet: Wallet): Promise<WalletAccount> {
  const feature = wallet.features["standard:connect"] as StandardConnectFeature["standard:connect"];
  const { accounts } = await feature.connect();
  const account = accounts.find((a) => a.features.includes("solana:signMessage")) ?? accounts[0];
  if (!account) throw new Error("The wallet did not share an account.");
  return account;
}

export async function signWalletMessage(wallet: Wallet, account: WalletAccount, message: Uint8Array): Promise<Uint8Array> {
  const feature = wallet.features["solana:signMessage"] as SolanaSignMessageFeature["solana:signMessage"];
  const [result] = await feature.signMessage({ account, message });
  if (!result) throw new Error("The wallet returned no signature.");
  return new Uint8Array(result.signature);
}

/**
 * Adapts a Wallet Standard account to a Kit signer. Wallets sign whole transactions and may
 * adjust them, so this is a modifying signer: the transaction it returns is the one that is sent.
 */
export function createWalletSigner(
  wallet: Wallet,
  account: WalletAccount,
  chain: `solana:${string}`,
): TransactionModifyingSigner<string> {
  const feature = wallet.features["solana:signTransaction"] as SolanaSignTransactionFeature["solana:signTransaction"];
  const encoder = getTransactionEncoder();
  const decoder = getTransactionDecoder();
  return {
    address: account.address as Address,
    async modifyAndSignTransactions(transactions) {
      const signed = [];
      for (const transaction of transactions) {
        const [result] = await feature.signTransaction({
          account,
          chain,
          transaction: new Uint8Array(encoder.encode(transaction)),
        });
        if (!result) throw new Error("The wallet returned no signed transaction.");
        // The wire format has no lifetime, so carry it over from the transaction we asked to sign.
        const decoded = decoder.decode(result.signedTransaction);
        signed.push("lifetimeConstraint" in transaction ? { ...decoded, lifetimeConstraint: transaction.lifetimeConstraint } : decoded);
      }
      return signed as never;
    },
  };
}
