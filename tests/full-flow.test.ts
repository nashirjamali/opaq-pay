/**
 * End-to-end flow on a local surfnet with the real programs:
 * vault setup → register handle → pay to handle → scan → sweep into vault → withdraw.
 * Requires `anchor build` at the repo root.
 */
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import type { Address, KeyPairSigner } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStealthSigner,
  deriveStealthScalar,
  fetchMetaAddress,
  fetchVaultSettings,
  findOwnPayments,
  findWrappedTokenAccount,
  generateMetaKeys,
  getPayToMetaAddressInstructions,
  getRegisterHandleInstruction,
  getSweepToVaultInstructions,
  vault,
  type MetaKeys,
  type OwnPayment,
  type VaultSettings,
} from '@opaq/sdk';
import { startTestNet, type TestNet } from './helpers.js';

const FEE_BPS = 50; // 0.5%
const PAYMENT = 25_000_000n; // 25 USDC
const FEE = (PAYMENT * BigInt(FEE_BPS)) / 10_000n;

let net: TestNet;
let usdc: Address;
let treasury: Address;
let settings: VaultSettings;

// Actors
let recipientWallet: KeyPairSigner; // owns the handle and the wrapper-token account
let recipientKeys: MetaKeys; // scan + spend seeds, kept off-chain by the recipient
let customer: KeyPairSigner;
let relayer: KeyPairSigner;

// Carried between steps
let paySignature: Parameters<TestNet['announcementsIn']>[0];
let stealthTokenAccount: Address;
let ownPayment: OwnPayment;

beforeAll(async () => {
  net = await startTestNet();
  recipientWallet = await net.fundedSigner();
  customer = await net.fundedSigner();
  relayer = await net.fundedSigner();
  recipientKeys = generateMetaKeys();

  usdc = await net.createUsdcMint();
  treasury = await net.createAta(net.admin.address, usdc);
  const [config] = await vault.findConfigPda();
  const wrappedMint = await net.createWrappedMint(config);

  await net.send(
    [
      await vault.getInitConfigInstructionAsync({
        admin: net.admin,
        underlyingMint: usdc,
        wrappedMint,
        treasury,
        underlyingTokenProgram: TOKEN_PROGRAM_ADDRESS,
        feeBps: FEE_BPS,
      }),
    ],
    net.admin,
  );
  settings = await fetchVaultSettings(net.rpc);
  await net.mintUsdc(usdc, customer.address, 100_000_000n);
});

afterAll(() => net?.stop());

describe('Opaq full flow', () => {
  it('reads the vault settings back from chain', () => {
    expect(settings.underlyingMint).toBe(usdc);
    expect(settings.treasury).toBe(treasury);
    expect(settings.feeBps).toBe(FEE_BPS);
    expect(settings.underlyingTokenProgram).toBe(TOKEN_PROGRAM_ADDRESS);
  });

  it('registers a handle with the recipient’s meta-address', async () => {
    await net.send(
      [await getRegisterHandleInstruction({ owner: recipientWallet, name: 'raka', meta: recipientKeys })],
      recipientWallet,
    );
    const meta = await fetchMetaAddress(net.rpc, 'raka');
    expect(meta?.owner).toBe(recipientWallet.address);
    expect([...meta!.scanPubkey]).toEqual([...recipientKeys.scanPubkey]);
    expect(await fetchMetaAddress(net.rpc, 'nobody_here')).toBeNull();
  });

  it('pays to the handle through a one-time address', async () => {
    const meta = await fetchMetaAddress(net.rpc, 'raka');
    const pay = await getPayToMetaAddressInstructions({
      payer: customer,
      meta: meta!,
      mint: usdc,
      decimals: 6,
      amount: PAYMENT,
    });
    paySignature = await net.send(pay.instructions, customer);
    stealthTokenAccount = pay.stealthTokenAccount;

    expect(await net.tokenBalance(stealthTokenAccount)).toBe(PAYMENT);
    // Nothing on-chain names the recipient: the funds sit at an address unrelated to their wallet.
    expect(pay.payment.stealthAddress).not.toBe(recipientWallet.address);
  });

  it('lets only the recipient find the payment from the announcement', async () => {
    const announcements = await net.announcementsIn(paySignature);
    expect(announcements).toHaveLength(1);

    const stranger = generateMetaKeys();
    expect(findOwnPayments(stranger.scanSeed, stranger.spendPubkey, announcements)).toHaveLength(0);

    const own = findOwnPayments(recipientKeys.scanSeed, recipientKeys.spendPubkey, announcements);
    expect(own).toHaveLength(1);
    ownPayment = own[0]!;
    const [expectedAta] = await findAssociatedTokenPda({
      owner: ownPayment.stealthAddress,
      mint: usdc,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    expect(expectedAta).toBe(stealthTokenAccount);
  });

  it('sweeps the payment into the vault with the relayer paying fees', async () => {
    const stealthSigner = createStealthSigner(deriveStealthScalar(recipientKeys.spendSeed, ownPayment.tweak));
    const destination = await net.createAta(recipientWallet.address, settings.wrappedMint, TOKEN_2022_PROGRAM_ADDRESS);
    expect(destination).toBe(await findWrappedTokenAccount(recipientWallet.address, settings.wrappedMint));

    const relayerLamportsBefore = (await net.rpc.getBalance(relayer.address).send()).value;
    const amount = await net.tokenBalance(stealthTokenAccount);
    await net.send(
      await getSweepToVaultInstructions({
        stealthSigner,
        vault: settings,
        destination,
        amount,
        rentRecipient: relayer.address,
      }),
      relayer,
    );

    expect(await net.tokenBalance(destination)).toBe(PAYMENT - FEE);
    expect(await net.tokenBalance(settings.vault)).toBe(PAYMENT - FEE);
    expect(await net.tokenBalance(treasury)).toBe(FEE);
    expect(await net.accountExists(stealthTokenAccount)).toBe(false);
    // Rent from the closed stealth account more than covers the relayer's transaction fee.
    expect((await net.rpc.getBalance(relayer.address).send()).value).toBeGreaterThan(relayerLamportsBefore);
  });

  it('withdraws wrapper tokens back to USDC 1:1', async () => {
    const wrapped = await findWrappedTokenAccount(recipientWallet.address, settings.wrappedMint);
    const usdcAccount = await net.createAta(recipientWallet.address, usdc);
    await net.send(
      [
        await vault.getWithdrawInstructionAsync({
          owner: recipientWallet,
          underlyingMint: usdc,
          wrappedMint: settings.wrappedMint,
          ownerWrapped: wrapped,
          vault: settings.vault,
          destination: usdcAccount,
          underlyingTokenProgram: TOKEN_PROGRAM_ADDRESS,
          amount: PAYMENT - FEE,
        }),
      ],
      recipientWallet,
    );

    expect(await net.tokenBalance(usdcAccount)).toBe(PAYMENT - FEE);
    expect(await net.tokenBalance(settings.vault)).toBe(0n);
    expect(await net.tokenBalance(wrapped)).toBe(0n);
  });

  it('rejects a sweep signed by someone other than the stealth key', async () => {
    const meta = await fetchMetaAddress(net.rpc, 'raka');
    const pay = await getPayToMetaAddressInstructions({ payer: customer, meta: meta!, mint: usdc, decimals: 6, amount: 1_000_000n });
    await net.send(pay.instructions, customer);

    const impostor = createStealthSigner(123456789n);
    const instructions = await getSweepToVaultInstructions({
      stealthSigner: impostor,
      vault: settings,
      destination: await findWrappedTokenAccount(recipientWallet.address, settings.wrappedMint),
      amount: 1_000_000n,
      rentRecipient: relayer.address,
    });
    await expect(net.send(instructions, relayer)).rejects.toThrow();
    expect(await net.tokenBalance(pay.stealthTokenAccount)).toBe(1_000_000n);
  });
});
