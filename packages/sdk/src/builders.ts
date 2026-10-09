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
  getMintDecoder,
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
import { LOCALNET_PROGRAMS, type OpaqPrograms } from './config.js';
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
export async function findEventAuthorityPda(programAddress: Address = LOCALNET_PROGRAMS.registry): Promise<Address> {
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
  programs?: OpaqPrograms;
}): Promise<Instruction> {
  if (!isValidHandleName(input.name)) throw new Error(`Invalid handle: ${input.name}`);
  return registry.getRegisterHandleInstructionAsync(
    {
      owner: input.owner,
      name: input.name,
      scanPubkey: input.meta.scanPubkey,
      spendPubkey: input.meta.spendPubkey,
    },
    { programAddress: (input.programs ?? LOCALNET_PROGRAMS).registry },
  );
}

/** Looks up a handle's meta-address. Returns null when the handle does not exist. */
export async function fetchMetaAddress(
  rpc: Rpc<GetAccountInfoApi>,
  name: string,
  programs: OpaqPrograms = LOCALNET_PROGRAMS,
): Promise<(MetaAddress & { handle: Address; owner: Address }) | null> {
  if (!isValidHandleName(name)) return null;
  const [handle] = await registry.findHandlePda({ name }, { programAddress: programs.registry });
  const account = await registry.fetchMaybeHandle(rpc, handle);
  if (!account.exists) return null;
  if (account.programAddress !== programs.registry) throw new Error('Handle account is not owned by opaq_registry');
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
  programs?: OpaqPrograms;
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
  const registryProgram = (input.programs ?? LOCALNET_PROGRAMS).registry;
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
    registry.getAnnounceInstruction(
      {
        announcer: input.payer,
        eventAuthority: await findEventAuthorityPda(registryProgram),
        program: registryProgram,
        ephemeralPubkey: payment.ephemeralPubkey,
        stealthAddress: payment.stealthAddress,
        viewTag: payment.viewTag,
      },
      { programAddress: registryProgram },
    ),
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
  /** The `opaq_vault` program these settings were read from. */
  programAddress: Address;
  config: Address;
  underlyingMint: Address;
  wrappedMint: Address;
  vault: Address;
  treasury: Address;
  feeBps: number;
  underlyingTokenProgram: Address;
  /** Decimals of the underlying mint, which the wrapper mint shares. */
  decimals: number;
};

/** Reads the vault config and the underlying mint's token program. */
export async function fetchVaultSettings(
  rpc: Rpc<GetAccountInfoApi>,
  programs: OpaqPrograms = LOCALNET_PROGRAMS,
): Promise<VaultSettings> {
  const [config] = await vault.findConfigPda({ programAddress: programs.vault });
  const account = await vault.fetchConfig(rpc, config);
  if (account.programAddress !== programs.vault) throw new Error('Vault config is not owned by opaq_vault');
  const mint = await fetchEncodedAccount(rpc, account.data.underlyingMint);
  if (!mint.exists) throw new Error('Underlying mint not found');
  if (mint.programAddress !== TOKEN_PROGRAM_ADDRESS && mint.programAddress !== TOKEN_2022_PROGRAM_ADDRESS) {
    throw new Error('Underlying mint is not owned by a token program');
  }
  // The base mint layout is shared by both token programs.
  const { decimals } = getMintDecoder().decode(mint.data);
  return {
    programAddress: programs.vault,
    config,
    underlyingMint: account.data.underlyingMint,
    wrappedMint: account.data.wrappedMint,
    vault: account.data.vault,
    treasury: account.data.treasury,
    feeBps: account.data.feeBps,
    underlyingTokenProgram: mint.programAddress,
    decimals,
  };
}

export type SweepToVaultInput = {
  /** Signer for the stealth address, see `createStealthSigner`. */
  stealthSigner: TransactionSigner;
  vault: VaultSettings;
  /** Whole balance of the stealth token account; the account is closed afterwards. */
  amount: bigint;
  /** Receives the stealth token account's rent when it is closed (e.g. the relayer). */
  rentRecipient: Address;
} & (
  | {
      /**
       * Pays for the stealth address's own wrapper account if it does not exist yet (the
       * relayer). The default: the wrapped tokens stay with the stealth address, so nothing
       * on chain links the payment to the recipient's wallet.
       */
      accountPayer: TransactionSigner;
      destination?: undefined;
    }
  | {
      /**
       * Explicit wrapper-token account to mint into. Sweeping into an account the recipient's
       * wallet owns publicly links this payment to that wallet; avoid unless that is intended.
       */
      destination: Address;
      accountPayer?: undefined;
    }
);

/**
 * Deposits the stealth token account's balance into the vault and closes the emptied stealth
 * token account. By default the wrapper tokens are minted to the stealth address's own
 * wrapper account (created idempotently), which `@opaq/sdk/confidential` can then shield.
 * The stealth signer only authorises; the fee payer is the caller's choice (the relayer).
 */
export async function getSweepToVaultInstructions(input: SweepToVaultInput): Promise<Instruction[]> {
  if (input.amount <= 0n) throw new Error('Amount must be greater than zero');
  const settings = input.vault;
  const [stealthTokenAccount] = await findAssociatedTokenPda({
    owner: input.stealthSigner.address,
    mint: settings.underlyingMint,
    tokenProgram: settings.underlyingTokenProgram,
  });

  const instructions: Instruction[] = [];
  let destination: Address;
  if (input.destination !== undefined) {
    destination = input.destination;
  } else {
    const created = await getCreateWrappedTokenAccountInstruction({
      payer: input.accountPayer,
      owner: input.stealthSigner.address,
      vault: settings,
    });
    instructions.push(created.instruction);
    destination = created.wrappedTokenAccount;
  }

  instructions.push(
    vault.getDepositInstruction(
      {
        depositor: input.stealthSigner,
        config: settings.config,
        underlyingMint: settings.underlyingMint,
        wrappedMint: settings.wrappedMint,
        depositorToken: stealthTokenAccount,
        vault: settings.vault,
        treasury: settings.treasury,
        destination,
        underlyingTokenProgram: settings.underlyingTokenProgram,
        wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        amount: input.amount,
      },
      { programAddress: settings.programAddress },
    ),
    getCloseAccountInstruction(
      { account: stealthTokenAccount, destination: input.rentRecipient, owner: input.stealthSigner },
      { programAddress: settings.underlyingTokenProgram },
    ),
  );
  return instructions;
}

/** Recipient's wrapper-token ATA (Token-2022). */
export async function findWrappedTokenAccount(owner: Address, wrappedMint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: wrappedMint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return ata;
}

/** Creates the recipient's wrapper-token account (Token-2022 ATA) if it does not exist yet. */
export async function getCreateWrappedTokenAccountInstruction(input: {
  payer: TransactionSigner;
  owner: Address;
  vault: VaultSettings;
}): Promise<{ instruction: Instruction; wrappedTokenAccount: Address }> {
  const wrappedTokenAccount = await findWrappedTokenAccount(input.owner, input.vault.wrappedMint);
  return {
    wrappedTokenAccount,
    instruction: getCreateAssociatedTokenIdempotentInstruction({
      payer: input.payer,
      ata: wrappedTokenAccount,
      owner: input.owner,
      mint: input.vault.wrappedMint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
  };
}

export type WithdrawFromVaultInput = {
  owner: TransactionSigner;
  vault: VaultSettings;
  amount: bigint;
  /** Where the USDC goes; defaults to the owner's ATA for the underlying mint. */
  destination?: Address;
  /** Wrapper-token account to burn from; defaults to the owner's wrapper ATA. */
  ownerWrapped?: Address;
};

/**
 * Burns `amount` wrapper tokens from the owner and sends the same amount of USDC out of the
 * vault. Only the non-confidential (public) wrapper balance can be withdrawn this way;
 * confidential balance must first be moved to public with Token-2022 `Withdraw`.
 */
export async function getWithdrawFromVaultInstruction(input: WithdrawFromVaultInput): Promise<Instruction> {
  if (input.amount <= 0n) throw new Error('Amount must be greater than zero');
  const settings = input.vault;
  const destination =
    input.destination ??
    (
      await findAssociatedTokenPda({
        owner: input.owner.address,
        mint: settings.underlyingMint,
        tokenProgram: settings.underlyingTokenProgram,
      })
    )[0];
  const ownerWrapped = input.ownerWrapped ?? (await findWrappedTokenAccount(input.owner.address, settings.wrappedMint));

  return vault.getWithdrawInstruction(
    {
      owner: input.owner,
      config: settings.config,
      underlyingMint: settings.underlyingMint,
      wrappedMint: settings.wrappedMint,
      ownerWrapped,
      vault: settings.vault,
      destination,
      underlyingTokenProgram: settings.underlyingTokenProgram,
      wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      amount: input.amount,
    },
    { programAddress: settings.programAddress },
  );
}

export { TOKEN_PROGRAM_ADDRESS };
