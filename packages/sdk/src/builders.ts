/**
 * High-level instruction builders for the Opaq payment flow:
 * register a handle → pay to a handle → recipient scans → sweep into the vault.
 *
 * Builders only return instructions. Callers choose the fee payer, blockhash and when to
 * send, so a relayer can pay fees for a sweep signed by the stealth address.
 */
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  fetchEncodedAccount,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit';
import * as registry from './generated/registry/index.js';
import * as vault from './generated/vault/index.js';
import { deriveStealthPayment, scanAnnouncement, type Announcement, type MetaAddress, type StealthPayment } from './stealth.js';

export const TOKEN_2022_PROGRAM_ADDRESS = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;

const HANDLE_PATTERN = /^[a-z0-9_]{3,32}$/;

/** Same rules as `opaq_registry`: 3-32 characters of a-z, 0-9 or _. */
export function isValidHandleName(name: string): boolean {
  return HANDLE_PATTERN.test(name);
}

/** Anchor `emit_cpi!` authority for a program. */
export async function findEventAuthorityPda(
  programAddress: Address = registry.OPAQ_REGISTRY_PROGRAM_ADDRESS,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [getUtf8Encoder().encode('__event_authority')],
  });
  return pda;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export async function getRegisterHandleInstruction(input: {
  owner: TransactionSigner;
  name: string;
  meta: MetaAddress;
}): Promise<Instruction> {
  if (!isValidHandleName(input.name)) throw new Error(`Invalid handle: ${input.name}`);
  return registry.getRegisterHandleInstructionAsync({
    owner: input.owner,
    name: input.name,
    scanPubkey: input.meta.scanPubkey,
    spendPubkey: input.meta.spendPubkey,
  });
}

/** Looks up a handle's meta-address. Returns null when the handle does not exist. */
export async function fetchMetaAddress(
  rpc: Rpc<GetAccountInfoApi>,
  name: string,
): Promise<(MetaAddress & { handle: Address; owner: Address }) | null> {
  if (!isValidHandleName(name)) return null;
  const [handle] = await registry.findHandlePda({ name });
  const account = await registry.fetchMaybeHandle(rpc, handle);
  if (!account.exists) return null;
  return {
    handle,
    owner: account.data.owner,
    scanPubkey: new Uint8Array(account.data.scanPubkey),
    spendPubkey: new Uint8Array(account.data.spendPubkey),
  };
}

// ---------------------------------------------------------------------------
// Payer: pay to a meta-address
// ---------------------------------------------------------------------------

export type PayToMetaAddressInput = {
  payer: TransactionSigner;
  meta: MetaAddress;
  mint: Address;
  decimals: number;
  amount: bigint;
  /** Payer's token account; defaults to the payer's ATA for `mint`. */
  source?: Address;
  tokenProgram?: Address;
  /** Deterministic tests only. Production callers must omit it. */
  ephemeralSeed?: Uint8Array;
};

export type PayToMetaAddressResult = {
  instructions: Instruction[];
  payment: StealthPayment;
  /** Token account owned by the stealth address that receives the funds. */
  stealthTokenAccount: Address;
};

/**
 * Creates the stealth address's token account, transfers the funds into it and announces
 * the payment, all in one transaction. The payer pays rent for the new token account.
 */
export async function getPayToMetaAddressInstructions(
  input: PayToMetaAddressInput,
): Promise<PayToMetaAddressResult> {
  if (input.amount <= 0n) throw new Error('Amount must be greater than zero');
  const tokenProgram = input.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  const payment = deriveStealthPayment(input.meta, input.ephemeralSeed);

  const [stealthTokenAccount] = await findAssociatedTokenPda({
    owner: payment.stealthAddress,
    mint: input.mint,
    tokenProgram,
  });
  const source =
    input.source ??
    (await findAssociatedTokenPda({ owner: input.payer.address, mint: input.mint, tokenProgram }))[0];

  const instructions: Instruction[] = [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: input.payer,
      ata: stealthTokenAccount,
      owner: payment.stealthAddress,
      mint: input.mint,
      tokenProgram,
    }),
    getTransferCheckedInstruction(
      {
        source,
        mint: input.mint,
        destination: stealthTokenAccount,
        authority: input.payer,
        amount: input.amount,
        decimals: input.decimals,
      },
      { programAddress: tokenProgram },
    ),
    registry.getAnnounceInstruction({
      announcer: input.payer,
      eventAuthority: await findEventAuthorityPda(),
      program: registry.OPAQ_REGISTRY_PROGRAM_ADDRESS,
      ephemeralPubkey: payment.ephemeralPubkey,
      stealthAddress: payment.stealthAddress,
      viewTag: payment.viewTag,
    }),
  ];

  return { instructions, payment, stealthTokenAccount };
}

// ---------------------------------------------------------------------------
// Recipient: find payments in announcements
// ---------------------------------------------------------------------------

/** Anchor `EVENT_IX_TAG_LE`: prefix of `emit_cpi!` self-invocation data (0x1d9acb512ea545e4, little-endian). */
export const EVENT_IX_TAG = new Uint8Array([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

/**
 * Decodes an `Announcement` from the data of an `emit_cpi!` inner instruction of
 * `opaq_registry`. Returns null for any other data. Input is untrusted chain data.
 */
export function decodeAnnouncementEventCpi(data: Uint8Array): Announcement | null {
  if (data.length < EVENT_IX_TAG.length) return null;
  for (let i = 0; i < EVENT_IX_TAG.length; i++) if (data[i] !== EVENT_IX_TAG[i]) return null;
  try {
    // The generated decoder reads and checks the event discriminator itself.
    const event = registry.getAnnouncementEventDecoder().decode(data, EVENT_IX_TAG.length);
    return {
      ephemeralPubkey: new Uint8Array(event.ephemeralPubkey),
      stealthAddress: event.stealthAddress,
      viewTag: event.viewTag,
    };
  } catch {
    return null;
  }
}

export type OwnPayment = Announcement & { tweak: bigint };

/** Filters announcements down to those addressed to the given recipient. */
export function findOwnPayments(
  scanSeed: Uint8Array,
  spendPubkey: Uint8Array,
  announcements: readonly Announcement[],
): OwnPayment[] {
  const own: OwnPayment[] = [];
  for (const announcement of announcements) {
    const match = scanAnnouncement(scanSeed, spendPubkey, announcement);
    if (match) own.push({ ...announcement, tweak: match.tweak });
  }
  return own;
}

// ---------------------------------------------------------------------------
// Recipient: sweep into the vault
// ---------------------------------------------------------------------------

export type VaultSettings = {
  config: Address;
  underlyingMint: Address;
  wrappedMint: Address;
  vault: Address;
  treasury: Address;
  feeBps: number;
  underlyingTokenProgram: Address;
};

/** Reads the vault config and the underlying mint's token program. */
export async function fetchVaultSettings(rpc: Rpc<GetAccountInfoApi>): Promise<VaultSettings> {
  const [config] = await vault.findConfigPda();
  const account = await vault.fetchConfig(rpc, config);
  const mint = await fetchEncodedAccount(rpc, account.data.underlyingMint);
  if (!mint.exists) throw new Error('Underlying mint not found');
  if (mint.programAddress !== TOKEN_PROGRAM_ADDRESS && mint.programAddress !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error('Underlying mint is not owned by a token program');
  }
  return {
    config,
    underlyingMint: account.data.underlyingMint,
    wrappedMint: account.data.wrappedMint,
    vault: account.data.vault,
    treasury: account.data.treasury,
    feeBps: account.data.feeBps,
    underlyingTokenProgram: mint.programAddress,
  };
}

export type SweepToVaultInput = {
  /** Signer for the stealth address, see `createStealthSigner`. */
  stealthSigner: TransactionSigner;
  vault: VaultSettings;
  /** Recipient's wrapper-token account (Token-2022) that receives the minted tokens. */
  destination: Address;
  /** Whole balance of the stealth token account; the account is closed afterwards. */
  amount: bigint;
  /** Receives the stealth token account's rent when it is closed (e.g. the relayer). */
  rentRecipient: Address;
};

/**
 * Deposits the stealth token account's balance into the vault, minting wrapper tokens to
 * `destination`, then closes the emptied stealth token account. The stealth signer only
 * authorises; the transaction fee payer is chosen by the caller (normally the relayer).
 */
export async function getSweepToVaultInstructions(input: SweepToVaultInput): Promise<Instruction[]> {
  if (input.amount <= 0n) throw new Error('Amount must be greater than zero');
  const settings = input.vault;
  const [stealthTokenAccount] = await findAssociatedTokenPda({
    owner: input.stealthSigner.address,
    mint: settings.underlyingMint,
    tokenProgram: settings.underlyingTokenProgram,
  });

  return [
    vault.getDepositInstruction({
      depositor: input.stealthSigner,
      config: settings.config,
      underlyingMint: settings.underlyingMint,
      wrappedMint: settings.wrappedMint,
      depositorToken: stealthTokenAccount,
      vault: settings.vault,
      treasury: settings.treasury,
      destination: input.destination,
      underlyingTokenProgram: settings.underlyingTokenProgram,
      wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      amount: input.amount,
    }),
    getCloseAccountInstruction(
      { account: stealthTokenAccount, destination: input.rentRecipient, owner: input.stealthSigner },
      { programAddress: settings.underlyingTokenProgram },
    ),
  ];
}

/** Recipient's wrapper-token ATA (Token-2022). */
export async function findWrappedTokenAccount(owner: Address, wrappedMint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: wrappedMint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return ata;
}

export { TOKEN_PROGRAM_ADDRESS };
