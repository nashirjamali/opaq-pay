/**
 * Payments that start on an EVM chain, through Circle CCTP V2.
 *
 * The payer burns USDC on the source chain with the stealth address's Solana USDC account as
 * `mintRecipient`; Circle attests the burn; anyone can then deliver the attested message to
 * Solana, which mints the USDC there. From that point the payment is an ordinary Opaq payment
 * (scan → sweep). The programs do not change.
 *
 * The payer has no Solana wallet, so a relayer does the three Solana steps: create the stealth
 * USDC account before the burn (CCTP cannot mint into a missing account), deliver the message,
 * and announce. `receive_message` nearly fills a transaction, so the announcement goes in its own.
 *
 * This module has no EVM dependency: it hands out the contract address, ABI fragments and
 * `depositForBurn` arguments for whatever EVM library the app uses (viem, ethers, wagmi).
 *
 * Privacy: the burn and the mint are public on both chains, so the payer's EVM address, the
 * amount and the stealth address are linked, as they are for a Solana payer. The recipient is not.
 */
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  AccountRole,
  address,
  fetchEncodedAccount,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type ReadonlyUint8Array,
  type Rpc,
  type TransactionSigner,
} from '@solana/kit';
import { findEventAuthorityPda } from './builders.js';
import { assertChainEnabled, LOCALNET_PROGRAMS, OpaqConfigError, type ChainId, type OpaqConfig, type OpaqPrograms } from './config.js';
import * as registry from './generated/registry/index.js';
import { deriveStealthPayment, type MetaAddress, type StealthPayment } from './stealth.js';

export type HexString = `0x${string}`;

/** Solana's CCTP domain, on mainnet and devnet. */
export const CCTP_SOLANA_DOMAIN = 5;
/** CCTP V2 programs, same addresses on mainnet and devnet. */
export const CCTP_MESSAGE_TRANSMITTER_PROGRAM_ADDRESS = address('CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC');
export const CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ADDRESS = address('CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe');
/** Circle's attestation service for testnets. */
export const CCTP_SANDBOX_API_URL = 'https://iris-api-sandbox.circle.com';

/** Human-readable ABI fragments, accepted by viem's `parseAbi` and by ethers. */
export const CCTP_TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
] as const;
export const CCTP_ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

export type CctpSourceChain = {
  chain: ChainId;
  name: string;
  evmChainId: number;
  /** CCTP domain of the source chain. */
  domain: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** USDC on the source chain (6 decimals through this ERC-20 interface). */
  usdc: HexString;
  /** CCTP `TokenMessengerV2`: approve it, then call `depositForBurn` on it. */
  tokenMessenger: HexString;
  /** Circle attestation API for this chain's network. */
  apiUrl: string;
};

/** `TokenMessengerV2` has the same address on every EVM testnet. */
const TESTNET_TOKEN_MESSENGER: HexString = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';

/**
 * Testnet source chains that pair with Solana devnet. A chain is usable once it is also
 * `available` in `CHAINS` and enabled in the config (`getCctpSourceChain`).
 */
export const CCTP_DEVNET_SOURCES: Partial<Record<ChainId, CctpSourceChain>> = {
  // Gas on Arc is paid in USDC, so a payer needs nothing but USDC.
  arc: {
    chain: 'arc',
    name: 'Arc Testnet',
    evmChainId: 5042002,
    domain: 26,
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerUrl: 'https://explorer.testnet.arc.io',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    usdc: '0x3600000000000000000000000000000000000000',
    tokenMessenger: TESTNET_TOKEN_MESSENGER,
    apiUrl: CCTP_SANDBOX_API_URL,
  },
  base: {
    chain: 'base',
    name: 'Base Sepolia',
    evmChainId: 84532,
    domain: 6,
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: TESTNET_TOKEN_MESSENGER,
    apiUrl: CCTP_SANDBOX_API_URL,
  },
};

/** The CCTP settings of an enabled source chain. Throws for Solana, disabled chains and localnet. */
export function getCctpSourceChain(config: OpaqConfig, chain: ChainId): CctpSourceChain {
  assertChainEnabled(config, chain);
  if (config.cluster !== 'devnet') throw new OpaqConfigError(`Cross-chain payments are not available on ${config.cluster}`);
  const source = CCTP_DEVNET_SOURCES[chain];
  if (!source) throw new OpaqConfigError(`Chain "${chain}" is not a cross-chain source`);
  return source;
}

// ---------------------------------------------------------------------------
// Before the burn
// ---------------------------------------------------------------------------

function toHex(bytes: ReadonlyUint8Array): HexString {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

function fromHex(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(value)) throw new Error(`Malformed ${label}`);
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}

export type PrepareCctpPaymentInput = {
  /** Pays rent for the stealth USDC account: the relayer. It gets the rent back at sweep. */
  accountPayer: TransactionSigner;
  meta: MetaAddress;
  /** USDC on Solana (`VaultSettings.underlyingMint`). */
  mint: Address;
  tokenProgram?: Address;
  /** Deterministic tests only. Production callers must omit it. */
  ephemeralSeed?: Uint8Array;
};

export type PrepareCctpPaymentResult = {
  /** Send before the burn. */
  instructions: Instruction[];
  /** Keep until the payment is announced (`getCctpAnnounceInstruction`). */
  payment: StealthPayment;
  stealthTokenAccount: Address;
  /** `mintRecipient` for `depositForBurn`: the token account, not the stealth address. */
  mintRecipient: HexString;
};

/** Derives the one-time address and creates its USDC account, which must exist before the mint. */
export async function getPrepareCctpPaymentInstructions(input: PrepareCctpPaymentInput): Promise<PrepareCctpPaymentResult> {
  const tokenProgram = input.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  const payment = deriveStealthPayment(input.meta, input.ephemeralSeed);
  const [stealthTokenAccount] = await findAssociatedTokenPda({ owner: payment.stealthAddress, mint: input.mint, tokenProgram });
  return {
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: input.accountPayer,
        ata: stealthTokenAccount,
        owner: payment.stealthAddress,
        mint: input.mint,
        tokenProgram,
      }),
    ],
    payment,
    stealthTokenAccount,
    mintRecipient: toHex(getAddressEncoder().encode(stealthTokenAccount)),
  };
}

export type CctpTransferQuote = {
  /** Upper bound of Circle's fee in USDC base units; the recipient gets `amount` minus the fee charged. */
  maxFee: bigint;
  /** 1000 = Fast Transfer, 2000 = wait for finality on the source chain. */
  minFinalityThreshold: number;
};

type FetchOptions = { fetch?: typeof fetch };

/** Circle's current fee for source → Solana; Fast Transfer when the route offers it. */
export async function fetchCctpTransferQuote(source: CctpSourceChain, amount: bigint, options: FetchOptions = {}): Promise<CctpTransferQuote> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(`${source.apiUrl}/v2/burn/USDC/fees/${source.domain}/${CCTP_SOLANA_DOMAIN}`);
  if (!response.ok) throw new Error(`CCTP fee quote failed (${response.status})`);
  const body: unknown = await response.json();
  const quotes = (Array.isArray(body) ? body : []).filter(
    (q): q is { finalityThreshold: number; minimumFee: number } =>
      typeof q?.finalityThreshold === 'number' && typeof q?.minimumFee === 'number' && q.minimumFee >= 0 && q.minimumFee <= 100,
  );
  const quote = quotes.find((q) => q.finalityThreshold === 1000) ?? quotes.find((q) => q.finalityThreshold === 2000);
  if (!quote) throw new Error('CCTP returned no fee quote for this route');
  // `minimumFee` is in basis points and can be fractional (1.3); round the fee up.
  const maxFee = (amount * BigInt(Math.round(quote.minimumFee * 10_000)) + 99_999_999n) / 100_000_000n;
  return { maxFee, minFinalityThreshold: quote.finalityThreshold };
}

/**
 * Arguments for `depositForBurn` on `source.tokenMessenger` (`CCTP_TOKEN_MESSENGER_ABI`). The
 * payer first approves `source.tokenMessenger` to spend `amount` of `source.usdc`.
 */
export function getCctpDepositForBurnArgs(input: {
  source: CctpSourceChain;
  amount: bigint;
  mintRecipient: HexString;
  quote: CctpTransferQuote;
}): readonly [bigint, number, HexString, HexString, HexString, bigint, number] {
  if (input.amount <= 0n) throw new Error('Amount must be greater than zero');
  if (input.quote.maxFee >= input.amount) throw new Error('Amount does not cover the CCTP fee');
  if (!/^0x[0-9a-f]{64}$/.test(input.mintRecipient)) throw new Error('mintRecipient must be 32 bytes');
  return [
    input.amount,
    CCTP_SOLANA_DOMAIN,
    input.mintRecipient,
    input.source.usdc,
    `0x${'00'.repeat(32)}`, // destinationCaller: anyone may deliver the message
    input.quote.maxFee,
    input.quote.minFinalityThreshold,
  ];
}

// ---------------------------------------------------------------------------
// After the burn
// ---------------------------------------------------------------------------

const HEADER_LENGTH = 148;
const BURN_BODY_LENGTH = 228;

export type CctpBurnMessage = {
  sourceDomain: number;
  destinationDomain: number;
  /** Unique per message; seeds the `used_nonce` account that prevents replays. */
  nonce: Uint8Array;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  /** Token burned on the source chain, left-padded to 32 bytes. */
  burnToken: Uint8Array;
  /** Solana token account that receives the mint. */
  mintRecipient: Address;
  amount: bigint;
  maxFee: bigint;
  feeExecuted: bigint;
};

function readUint256(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i++) value = (value << 8n) | BigInt(bytes[offset + i]!);
  return value;
}

/** Decodes a CCTP V2 burn message addressed to Solana's token messenger. Throws on anything else. */
export function decodeCctpBurnMessage(message: Uint8Array): CctpBurnMessage {
  if (message.length < HEADER_LENGTH + BURN_BODY_LENGTH) throw new Error('CCTP message is too short');
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const decoder = getAddressDecoder();
  if (view.getUint32(0) !== 1 || view.getUint32(HEADER_LENGTH) !== 1) throw new Error('Not a CCTP V2 burn message');
  if (decoder.decode(message.subarray(76, 108)) !== CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ADDRESS) {
    throw new Error('CCTP message is not addressed to the Solana token messenger');
  }
  const body = HEADER_LENGTH;
  return {
    sourceDomain: view.getUint32(4),
    destinationDomain: view.getUint32(8),
    nonce: message.slice(12, 44),
    minFinalityThreshold: view.getUint32(140),
    finalityThresholdExecuted: view.getUint32(144),
    burnToken: message.slice(body + 4, body + 36),
    mintRecipient: decoder.decode(message.subarray(body + 36, body + 68)),
    amount: readUint256(message, body + 68),
    maxFee: readUint256(message, body + 132),
    feeExecuted: readUint256(message, body + 164),
  };
}

export type CctpAttestedMessage = { message: Uint8Array; attestation: Uint8Array };

/**
 * Looks up the attested message for a burn transaction; null while Circle has not attested it.
 * The API is untrusted: Solana verifies the attestation, and callers should check the decoded
 * `mintRecipient` and `amount` against what they expect before paying to deliver it.
 */
export async function fetchCctpAttestation(
  source: CctpSourceChain,
  burnTransactionHash: string,
  options: FetchOptions = {},
): Promise<CctpAttestedMessage | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(burnTransactionHash)) throw new Error('Malformed transaction hash');
  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(`${source.apiUrl}/v2/messages/${source.domain}?transactionHash=${burnTransactionHash}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`CCTP attestation lookup failed (${response.status})`);
  const body = (await response.json()) as { messages?: { status?: unknown; message?: unknown; attestation?: unknown }[] };
  const found = body.messages?.[0];
  if (found?.status !== 'complete') return null;
  return { message: fromHex(found.message, 'CCTP message'), attestation: fromHex(found.attestation, 'CCTP attestation') };
}

/** Polls `fetchCctpAttestation`. Fast Transfer attests in seconds; a finalized one can take minutes. */
export async function waitForCctpAttestation(
  source: CctpSourceChain,
  burnTransactionHash: string,
  options: FetchOptions & { timeoutMs?: number; pollMs?: number } = {},
): Promise<CctpAttestedMessage> {
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  for (;;) {
    const attested = await fetchCctpAttestation(source, burnTransactionHash, options);
    if (attested) return attested;
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the CCTP attestation');
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 3000));
  }
}

const utf8 = getUtf8Encoder();
async function findPda(programAddress: Address, ...seeds: (string | ReadonlyUint8Array)[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: seeds.map((seed) => (typeof seed === 'string' ? utf8.encode(seed) : seed)),
  });
  return pda;
}

/** Anchor discriminator of `message_transmitter_v2::receive_message`. */
const RECEIVE_MESSAGE_DISCRIMINATOR = [38, 144, 127, 225, 31, 225, 238, 25];
/** Anchor discriminator of the token messenger's `TokenMessenger` account. */
const TOKEN_MESSENGER_DISCRIMINATOR = [162, 4, 242, 52, 147, 243, 221, 96];
/** `TokenMessenger`: discriminator, denylister, owner, pending_owner, u32, u8, then `fee_recipient`. */
const FEE_RECIPIENT_OFFSET = 109;
const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** A Kit `Instruction` whose accounts and data are always present. */
export type CctpReceiveMessageInstruction = {
  programAddress: Address;
  accounts: (AccountMeta | AccountSignerMeta)[];
  data: Uint8Array;
};

/**
 * Delivers an attested burn message to Solana, which mints the USDC into the message's
 * `mintRecipient`. `payer` (the relayer) pays the fee and the rent of the replay-protection
 * account. Account order follows Circle's `solana-cctp-contracts` (`examples/v2/solana.ts`).
 *
 * The instruction leaves almost no room in the transaction: send it on its own.
 */
export async function getCctpReceiveMessageInstruction(
  rpc: Rpc<GetAccountInfoApi>,
  input: {
    payer: TransactionSigner;
    message: Uint8Array;
    attestation: Uint8Array;
    /** USDC on Solana (`VaultSettings.underlyingMint`). */
    mint: Address;
  },
): Promise<CctpReceiveMessageInstruction> {
  const decoded = decodeCctpBurnMessage(input.message);
  if (decoded.destinationDomain !== CCTP_SOLANA_DOMAIN) throw new Error('CCTP message is not for Solana');

  const transmitter = CCTP_MESSAGE_TRANSMITTER_PROGRAM_ADDRESS;
  const messenger = CCTP_TOKEN_MESSENGER_MINTER_PROGRAM_ADDRESS;
  const encoder = getAddressEncoder();
  const domain = String(decoded.sourceDomain);
  const mint = encoder.encode(input.mint);

  const tokenMessenger = await findPda(messenger, 'token_messenger');
  const account = await fetchEncodedAccount(rpc, tokenMessenger);
  if (
    !account.exists ||
    account.programAddress !== messenger ||
    account.data.length < FEE_RECIPIENT_OFFSET + 32 ||
    !TOKEN_MESSENGER_DISCRIMINATOR.every((byte, i) => account.data[i] === byte)
  ) {
    throw new Error('CCTP token messenger account not found');
  }
  const feeRecipient = getAddressDecoder().decode(account.data.subarray(FEE_RECIPIENT_OFFSET, FEE_RECIPIENT_OFFSET + 32));
  const [feeRecipientTokenAccount] = await findAssociatedTokenPda({ owner: feeRecipient, mint: input.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });

  const readonly = (account: Address): AccountMeta => ({ address: account, role: AccountRole.READONLY });
  const writable = (account: Address): AccountMeta => ({ address: account, role: AccountRole.WRITABLE });
  return {
    programAddress: transmitter,
    accounts: [
      { address: input.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: input.payer }, // payer
      { address: input.payer.address, role: AccountRole.READONLY_SIGNER, signer: input.payer }, // caller
      readonly(await findPda(transmitter, 'message_transmitter_authority', encoder.encode(messenger))),
      readonly(await findPda(transmitter, 'message_transmitter')),
      writable(await findPda(transmitter, 'used_nonce', decoded.nonce)),
      readonly(messenger), // receiver
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(await findPda(transmitter, '__event_authority')),
      readonly(transmitter),
      // Remaining accounts, handed on to the token messenger.
      readonly(tokenMessenger),
      readonly(await findPda(messenger, 'remote_token_messenger', domain)),
      writable(await findPda(messenger, 'token_minter')),
      writable(await findPda(messenger, 'local_token', mint)),
      readonly(await findPda(messenger, 'token_pair', domain, decoded.burnToken)),
      writable(feeRecipientTokenAccount),
      writable(decoded.mintRecipient),
      writable(await findPda(messenger, 'custody', mint)),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(await findPda(messenger, '__event_authority')),
      readonly(messenger),
    ],
    data: new Uint8Array([
      ...RECEIVE_MESSAGE_DISCRIMINATOR,
      ...u32le(input.message.length),
      ...input.message,
      ...u32le(input.attestation.length),
      ...input.attestation,
    ]),
  };
}

/**
 * Announces a cross-chain payment so the recipient's scanner finds it. The announcer is the
 * relayer, since the payer has no Solana wallet; send it after the mint.
 */
export async function getCctpAnnounceInstruction(input: {
  announcer: TransactionSigner;
  payment: StealthPayment;
  programs?: OpaqPrograms;
}): Promise<Instruction> {
  const registryProgram = (input.programs ?? LOCALNET_PROGRAMS).registry;
  return registry.getAnnounceInstruction(
    {
      announcer: input.announcer,
      eventAuthority: await findEventAuthorityPda(registryProgram),
      program: registryProgram,
      ephemeralPubkey: input.payment.ephemeralPubkey,
      stealthAddress: input.payment.stealthAddress,
      viewTag: input.payment.viewTag,
    },
    { programAddress: registryProgram },
  );
}
