/**
 * Confidential balances on stealth-owned wrapper accounts (`@opaq/sdk/confidential`).
 *
 * After a sweep the wrapper tokens sit in the stealth address's own Token-2022 account. These
 * helpers configure that account for Confidential Transfer, shield its public balance, read it
 * back, unshield it and close the account. Every instruction is authorised by the stealth
 * signer; the fee payer (relayer) only pays.
 *
 * The account's ElGamal and AES keys are derived from the recipient's scan seed and the
 * stealth address (see docs/stealth-ct-keys.md), so the scan-only viewing key can decrypt
 * balances but cannot sign. This entry point pulls in the zk-sdk WASM module; the main
 * `@opaq/sdk` entry does not.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  fetchMaybeToken,
  getApplyConfidentialPendingBalanceInstruction,
  getCloseAccountInstruction,
  getConfidentialDepositInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from '@solana-program/token-2022';
import {
  decryptConfidentialTransferBalance,
  getConfidentialWithdrawInstructionPlan,
  getCreateConfidentialTransferAccountInstructionPlan,
  getEmptyConfidentialTransferAccountInstructionPlan,
} from '@solana-program/token-2022/confidential';
import { AeKey, ElGamalKeypair } from '@solana/zk-sdk/bundler';
import {
  getAddressEncoder,
  sequentialInstructionPlan,
  type Address,
  type GetAccountInfoApi,
  type GetMinimumBalanceForRentExemptionApi,
  type Instruction,
  type InstructionPlan,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit';
import { findWrappedTokenAccount, type VaultSettings } from './builders.js';

export type ConfidentialRpc = Rpc<GetAccountInfoApi & GetMinimumBalanceForRentExemptionApi>;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const KEY_SALT = utf8ToBytes('opaq/stealth-ct/v1');

/**
 * Seeds for one stealth account's confidential keys: HKDF-SHA256 over the scan seed, with the
 * stealth address in `info`. Exposed separately so the derivation can be checked against
 * independent implementations without loading WASM.
 */
export function deriveStealthConfidentialKeySeeds(
  scanSeed: Uint8Array,
  stealthAddress: Address,
): { elgamalSeed: Uint8Array; aeSeed: Uint8Array } {
  if (scanSeed.length !== 32) throw new Error('Scan seed must be 32 bytes');
  const address = new Uint8Array(getAddressEncoder().encode(stealthAddress));
  const expand = (label: string) =>
    hkdf(sha256, scanSeed, KEY_SALT, concatBytes(utf8ToBytes(`opaq/stealth-ct/v1/${label}`), address), 32);
  return { elgamalSeed: expand('elgamal'), aeSeed: expand('ae') };
}

export type StealthConfidentialKeys = {
  elgamalKeypair: ElGamalKeypair;
  aesKey: AeKey;
};

/** zk-sdk keys for the stealth address's confidential account (seed → `fromSeed`). */
export function deriveStealthConfidentialKeys(scanSeed: Uint8Array, stealthAddress: Address): StealthConfidentialKeys {
  return confidentialKeysFromSeeds(deriveStealthConfidentialKeySeeds(scanSeed, stealthAddress));
}

export function confidentialKeysFromSeeds(seeds: { elgamalSeed: Uint8Array; aeSeed: Uint8Array }): StealthConfidentialKeys {
  return { elgamalKeypair: ElGamalKeypair.fromSeed(seeds.elgamalSeed), aesKey: AeKey.fromSeed(seeds.aeSeed) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type StealthWrappedBalance = {
  wrappedTokenAccount: Address;
  exists: boolean;
  /** Configured for Confidential Transfer. */
  confidential: boolean;
  /** Plaintext balance, visible to everyone. */
  publicAmount: bigint;
  /** Shielded balance that has been applied (spendable confidentially). */
  available: bigint;
  /** Shielded credits not yet applied. */
  pending: bigint;
  total: bigint;
};

function hasConfidentialExtension(token: Token): boolean {
  return (
    token.extensions.__option === 'Some' &&
    token.extensions.value.some((extension) => extension.__kind === 'ConfidentialTransferAccount')
  );
}

async function fetchStealthWrapped(rpc: Rpc<GetAccountInfoApi>, stealthAddress: Address, vault: Pick<VaultSettings, 'wrappedMint'>) {
  const wrappedTokenAccount = await findWrappedTokenAccount(stealthAddress, vault.wrappedMint);
  const account = await fetchMaybeToken(rpc, wrappedTokenAccount);
  if (account.exists && (account.data.owner !== stealthAddress || account.data.mint !== vault.wrappedMint)) {
    throw new Error('Wrapper account does not belong to this stealth address');
  }
  return { wrappedTokenAccount, account };
}

/**
 * Balance of a stealth address's wrapper account, decrypted with keys derived from the scan
 * seed. A viewing-key holder can call this.
 */
export async function fetchStealthWrappedBalance(
  rpc: Rpc<GetAccountInfoApi>,
  input: { scanSeed: Uint8Array; stealthAddress: Address; vault: Pick<VaultSettings, 'wrappedMint'> },
): Promise<StealthWrappedBalance> {
  return fetchStealthWrappedBalanceWithKeys(rpc, {
    stealthAddress: input.stealthAddress,
    vault: input.vault,
    keys: () => deriveStealthConfidentialKeys(input.scanSeed, input.stealthAddress),
  });
}

/** Same as `fetchStealthWrappedBalance`, with the account's keys supplied directly (disclosures). */
export async function fetchStealthWrappedBalanceWithKeys(
  rpc: Rpc<GetAccountInfoApi>,
  input: { stealthAddress: Address; vault: Pick<VaultSettings, 'wrappedMint'>; keys: () => StealthConfidentialKeys },
): Promise<StealthWrappedBalance> {
  const { wrappedTokenAccount, account } = await fetchStealthWrapped(rpc, input.stealthAddress, input.vault);
  if (!account.exists) {
    return { wrappedTokenAccount, exists: false, confidential: false, publicAmount: 0n, available: 0n, pending: 0n, total: 0n };
  }
  const publicAmount = account.data.amount;
  if (!hasConfidentialExtension(account.data)) {
    return { wrappedTokenAccount, exists: true, confidential: false, publicAmount, available: 0n, pending: 0n, total: publicAmount };
  }
  const keys = input.keys();
  const decrypted = decryptConfidentialTransferBalance({
    tokenAccount: account.data,
    elgamalSecretKey: keys.elgamalKeypair.secret(),
    aesKey: keys.aesKey,
  });
  return {
    wrappedTokenAccount,
    exists: true,
    confidential: true,
    publicAmount,
    available: decrypted.availableBalance,
    pending: decrypted.pendingBalance,
    total: publicAmount + decrypted.availableBalance + decrypted.pendingBalance,
  };
}

// ---------------------------------------------------------------------------
// Writing (stealth signer authorises, `payer` pays)
// ---------------------------------------------------------------------------

export type StealthConfidentialInput = {
  rpc: ConfidentialRpc;
  /** Pays fees and rent (the relayer). */
  payer: TransactionSigner;
  /** See `createStealthSigner`. */
  stealthSigner: TransactionSigner;
  scanSeed: Uint8Array;
  vault: VaultSettings;
};

/**
 * One transaction: create the stealth wrapper account if needed, add the Confidential
 * Transfer extension and configure it with the derived ElGamal key (pubkey-validity proof
 * included). Idempotent for the account creation, not for the configuration: call it only
 * when `fetchStealthWrappedBalance` reports `confidential: false`.
 */
export async function getConfigureStealthAccountInstructionPlan(input: StealthConfidentialInput): Promise<InstructionPlan> {
  const keys = deriveStealthConfidentialKeys(input.scanSeed, input.stealthSigner.address);
  return getCreateConfidentialTransferAccountInstructionPlan({
    rpc: input.rpc,
    payer: input.payer,
    owner: input.stealthSigner,
    mint: input.vault.wrappedMint,
    elgamalKeypair: keys.elgamalKeypair,
    aesKey: keys.aesKey,
  });
}

/**
 * Moves the whole public balance into the confidential available balance in one
 * transaction: `ConfidentialDeposit` (credits pending, bumps the credit counter) followed by
 * `ApplyPendingBalance` with the counter and decryptable balance that deposit will produce.
 * Returns an empty list when there is nothing public to shield.
 */
export async function getShieldInstructions(input: Omit<StealthConfidentialInput, 'payer'>): Promise<Instruction[]> {
  const { wrappedTokenAccount, account } = await fetchStealthWrapped(input.rpc, input.stealthSigner.address, input.vault);
  if (!account.exists || !hasConfidentialExtension(account.data)) {
    throw new Error('Configure the stealth wrapper account first');
  }
  const amount = account.data.amount;
  if (amount === 0n) return [];

  const keys = deriveStealthConfidentialKeys(input.scanSeed, input.stealthSigner.address);
  const current = decryptConfidentialTransferBalance({
    tokenAccount: account.data,
    elgamalSecretKey: keys.elgamalKeypair.secret(),
    aesKey: keys.aesKey,
  });
  return [
    getConfidentialDepositInstruction({
      token: wrappedTokenAccount,
      mint: input.vault.wrappedMint,
      authority: input.stealthSigner,
      amount,
      decimals: input.vault.decimals,
    }),
    getApplyConfidentialPendingBalanceInstruction({
      token: wrappedTokenAccount,
      authority: input.stealthSigner,
      expectedPendingBalanceCreditCounter: current.pendingBalanceCreditCounter + 1n,
      newDecryptableAvailableBalance: keys.aesKey
        .encrypt(current.availableBalance + current.pendingBalance + amount)
        .toBytes(),
    }),
  ];
}

/**
 * Moves `amount` (default: everything available) from the confidential balance back to the
 * public balance, after which `getWithdrawFromVaultInstruction` can cash it out. Several
 * transactions (equality and range proofs in context-state accounts, closed at the end).
 */
export async function getUnshieldInstructionPlan(
  input: StealthConfidentialInput & { amount?: bigint },
): Promise<InstructionPlan> {
  const { wrappedTokenAccount, account } = await fetchStealthWrapped(input.rpc, input.stealthSigner.address, input.vault);
  if (!account.exists || !hasConfidentialExtension(account.data)) throw new Error('No confidential account to unshield');
  const keys = deriveStealthConfidentialKeys(input.scanSeed, input.stealthSigner.address);
  const { availableBalance } = decryptConfidentialTransferBalance({
    tokenAccount: account.data,
    elgamalSecretKey: keys.elgamalKeypair.secret(),
    aesKey: keys.aesKey,
  });
  const amount = input.amount ?? availableBalance;
  if (amount <= 0n || amount > availableBalance) throw new Error(`Cannot unshield ${amount}; available ${availableBalance}`);
  return getConfidentialWithdrawInstructionPlan({
    rpc: input.rpc,
    payer: input.payer,
    token: wrappedTokenAccount,
    mint: input.vault.wrappedMint,
    tokenAccount: account.data,
    authority: input.stealthSigner,
    amount,
    decimals: input.vault.decimals,
    elgamalKeypair: keys.elgamalKeypair,
    aesKey: keys.aesKey,
  });
}

/**
 * Empties the confidential state (zero-ciphertext proof) and closes the stealth wrapper
 * account, returning its rent to `rentRecipient`. The account must hold no public, pending
 * or available balance.
 */
export async function getCloseStealthAccountInstructionPlan(
  input: StealthConfidentialInput & { rentRecipient: Address },
): Promise<InstructionPlan> {
  const balance = await fetchStealthWrappedBalance(input.rpc, {
    scanSeed: input.scanSeed,
    stealthAddress: input.stealthSigner.address,
    vault: input.vault,
  });
  if (!balance.exists) throw new Error('Nothing to close');
  if (balance.total !== 0n) throw new Error(`Account still holds ${balance.total}`);

  const close = getCloseAccountInstruction(
    { account: balance.wrappedTokenAccount, destination: input.rentRecipient, owner: input.stealthSigner },
    { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
  );
  if (!balance.confidential) return sequentialInstructionPlan([close]);

  const { account } = await fetchStealthWrapped(input.rpc, input.stealthSigner.address, input.vault);
  if (!account.exists) throw new Error('Nothing to close');
  const keys = deriveStealthConfidentialKeys(input.scanSeed, input.stealthSigner.address);
  return sequentialInstructionPlan([
    await getEmptyConfidentialTransferAccountInstructionPlan({
      rpc: input.rpc,
      payer: input.payer,
      token: balance.wrappedTokenAccount,
      tokenAccount: account.data,
      authority: input.stealthSigner,
      elgamalKeypair: keys.elgamalKeypair,
    }),
    close,
  ]);
}

export * from './disclosure.js';
