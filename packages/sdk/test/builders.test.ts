import { sha256 } from '@noble/hashes/sha2.js';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { address, AccountRole, generateKeyPairSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  createStealthSigner,
  decodeAnnouncementEventCpi,
  deriveStealthScalar,
  EVENT_IX_TAG,
  findOwnPayments,
  generateMetaKeys,
  getPayToMetaAddressInstructions,
  getRegisterHandleInstruction,
  getSweepToVaultInstructions,
  isValidHandleName,
  registry,
  TOKEN_2022_PROGRAM_ADDRESS,
  vault,
  type VaultSettings,
} from '../src/index.js';

const USDC = address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

describe('handles', () => {
  it('validates names like the program', () => {
    for (const name of ['raka', 'dina_31', 'abc', 'a'.repeat(32)]) expect(isValidHandleName(name)).toBe(true);
    for (const name of ['ab', 'Raka', 'ra-ka', 'a'.repeat(33), '']) expect(isValidHandleName(name)).toBe(false);
  });

  it('builds register_handle for the handle PDA', async () => {
    const owner = await generateKeyPairSigner();
    const meta = generateMetaKeys();
    const ix = await getRegisterHandleInstruction({ owner, name: 'raka', meta });
    const [handle] = await registry.findHandlePda({ name: 'raka' });
    expect(ix.programAddress).toBe(registry.OPAQ_REGISTRY_PROGRAM_ADDRESS);
    expect(ix.accounts?.[1]?.address).toBe(handle);
    const data = registry.getRegisterHandleInstructionDataDecoder().decode(ix.data!);
    expect(data.name).toBe('raka');
    expect([...data.scanPubkey]).toEqual([...meta.scanPubkey]);
    await expect(getRegisterHandleInstruction({ owner, name: 'Bad!', meta })).rejects.toThrow();
  });
});

describe('paying to a meta-address', () => {
  it('creates the stealth token account, transfers, and announces', async () => {
    const payer = await generateKeyPairSigner();
    const recipient = generateMetaKeys();
    const { instructions, payment, stealthTokenAccount } = await getPayToMetaAddressInstructions({
      payer,
      meta: recipient,
      mint: USDC,
      decimals: 6,
      amount: 25_000_000n,
    });

    expect(instructions.map((ix) => ix.programAddress)).toEqual([
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      TOKEN_PROGRAM_ADDRESS,
      registry.OPAQ_REGISTRY_PROGRAM_ADDRESS,
    ]);
    const [expectedAta] = await findAssociatedTokenPda({
      owner: payment.stealthAddress,
      mint: USDC,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    expect(stealthTokenAccount).toBe(expectedAta);
    expect(instructions[1]!.accounts?.[2]?.address).toBe(stealthTokenAccount);

    // The recipient can recover the payment from the announce instruction alone.
    const announced = registry.getAnnounceInstructionDataDecoder().decode(instructions[2]!.data!);
    const found = findOwnPayments(recipient.scanSeed, recipient.spendPubkey, [
      {
        ephemeralPubkey: new Uint8Array(announced.ephemeralPubkey),
        stealthAddress: announced.stealthAddress,
        viewTag: announced.viewTag,
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.stealthAddress).toBe(payment.stealthAddress);
  });

  it('rejects non-positive amounts', async () => {
    const payer = await generateKeyPairSigner();
    await expect(
      getPayToMetaAddressInstructions({ payer, meta: generateMetaKeys(), mint: USDC, decimals: 6, amount: 0n }),
    ).rejects.toThrow();
  });
});

describe('announcement events', () => {
  it('uses Anchor’s event-cpi tag (EVENT_IX_TAG_LE)', () => {
    // Anchor: EVENT_IX_TAG = 0x1d9acb512ea545e4 (sha256("anchor:event")[..8] read big-endian),
    // written to instruction data as little-endian bytes.
    const prefix = sha256(new TextEncoder().encode('anchor:event')).subarray(0, 8);
    expect([...EVENT_IX_TAG]).toEqual([...prefix].reverse());
  });

  it('decodes emit_cpi data and ignores anything else', async () => {
    const event = {
      ephemeralPubkey: new Uint8Array(32).fill(9),
      stealthAddress: (await generateKeyPairSigner()).address,
      viewTag: 42,
      announcer: (await generateKeyPairSigner()).address,
    };
    // Same layout as on-chain: tag, then the encoded event (which starts with its discriminator).
    const body = registry.getAnnouncementEventEncoder().encode(event);
    expect([...body.slice(0, 8)]).toEqual([...registry.ANNOUNCEMENT_EVENT_DISCRIMINATOR]);
    const data = new Uint8Array([...EVENT_IX_TAG, ...body]);

    expect(decodeAnnouncementEventCpi(data)).toEqual({
      ephemeralPubkey: event.ephemeralPubkey,
      stealthAddress: event.stealthAddress,
      viewTag: 42,
    });
    expect(decodeAnnouncementEventCpi(data.subarray(0, 20))).toBeNull();
    const wrongTag = data.slice();
    wrongTag[0] = 0;
    expect(decodeAnnouncementEventCpi(wrongTag)).toBeNull();
    const wrongEvent = data.slice();
    wrongEvent[8] = 0; // corrupt the event discriminator
    expect(decodeAnnouncementEventCpi(wrongEvent)).toBeNull();
  });
});

describe('sweeping into the vault', () => {
  it('deposits from the stealth token account and closes it', async () => {
    const recipient = generateMetaKeys();
    const payer = await generateKeyPairSigner();
    const { payment, stealthTokenAccount } = await getPayToMetaAddressInstructions({
      payer,
      meta: recipient,
      mint: USDC,
      decimals: 6,
      amount: 1_000_000n,
    });
    const [own] = findOwnPayments(recipient.scanSeed, recipient.spendPubkey, [payment]);
    const stealthSigner = createStealthSigner(deriveStealthScalar(recipient.spendSeed, own!.tweak));

    const [config] = await vault.findConfigPda();
    const settings: VaultSettings = {
      config,
      underlyingMint: USDC,
      wrappedMint: (await generateKeyPairSigner()).address,
      vault: (await generateKeyPairSigner()).address,
      treasury: (await generateKeyPairSigner()).address,
      feeBps: 50,
      underlyingTokenProgram: TOKEN_PROGRAM_ADDRESS,
    };
    const destination = (await generateKeyPairSigner()).address as Address;
    const relayer = (await generateKeyPairSigner()).address;

    const [deposit, close] = await getSweepToVaultInstructions({
      stealthSigner,
      vault: settings,
      destination,
      amount: 1_000_000n,
      rentRecipient: relayer,
    });

    const parsed = vault.parseDepositInstruction(deposit as Parameters<typeof vault.parseDepositInstruction>[0]);
    expect(parsed.accounts.depositor.address).toBe(payment.stealthAddress);
    expect(parsed.accounts.depositor.role).toBe(AccountRole.READONLY_SIGNER);
    expect(parsed.accounts.depositorToken.address).toBe(stealthTokenAccount);
    expect(parsed.accounts.destination.address).toBe(destination);
    expect(parsed.accounts.wrappedTokenProgram.address).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(parsed.data.amount).toBe(1_000_000n);

    expect(close!.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(close!.accounts?.map((a) => a.address)).toEqual([stealthTokenAccount, relayer, payment.stealthAddress]);
  });
});
