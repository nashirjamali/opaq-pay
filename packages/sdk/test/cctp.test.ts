import { AccountRole, generateKeyPairSigner, type Address, type GetAccountInfoApi, type Rpc } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  CCTP_DEVNET_SOURCES,
  CCTP_MESSAGE_TRANSMITTER_PROGRAM_ADDRESS,
  CCTP_SOLANA_DOMAIN,
  createConfig,
  createThrowawaySigner,
  decodeCctpBurnMessage,
  DEVNET_PROGRAMS,
  fetchCctpAttestation,
  fetchCctpTransferQuote,
  findCctpUsedNoncePda,
  generateMetaKeys,
  getCctpAnnounceInstruction,
  getCctpDepositForBurnArgs,
  getCctpReceiveMessageInstruction,
  getCctpSourceChain,
  getPrepareCctpPaymentInstructions,
  isCctpMessageReceived,
  OpaqConfigError,
  parseEnabledChains,
  scanAnnouncement,
  verifySignature,
} from '../src/index.js';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as Address;
const arc = CCTP_DEVNET_SOURCES.arc!;

// A real transfer: 1 USDC burned on Arc Testnet (0x899cfd64…d12a5b), minted on Solana devnet in
// 2RgtiBJESjd1R6jZqq2cdQtDeZwjUeFfTXVmda4Y2yxoQ98tprxU1YuJsk6W2vgp2dXYGewTnQEmbh5jvX4RKgL7.
const BURN_TX = '0x899cfd64e0564289b8dda00893a0ef21cbf34cd30d6561b8b47350cf85d12a5b';
const MESSAGE_HEX =
  '0x000000010000001a00000005e739d6f8c210be7e8827cd1b07e5db5840537e817cc1dde0190b0adb72d7f2330000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daaa65fc81d0fefa8860cb3b83f089b0224be8a6687b7ae49f594c0b9b4d7e938930000000000000000000000000000000000000000000000000000000000000000000003e8000007d00000000100000000000000000000000036000000000000000000000000000000000000006ba7c7d3591731e1007dab689519e16c8009030bf6075fe306c03f86091752f100000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000f7e70882a0e2b2ec8a0ab70d6d01f978a815317000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
const ATTESTATION_HEX =
  '0xb218cd80869e7d3dea9378fe5dbdac0fa1d61782951171674c67390a91c750f431bd5cdbbbf05063b0d947f225843d2234ccd08db0c240ba1cb0eb321b7d99221c32b2fcc67522aaaa45ce0394e7311015ee7ec4c8e01f569c72c8ec0548b132e035249acd9a45b3f8d2c73f0b819d054e57f162b982ce250cea28aeac0fffb4011c';
const MESSAGE = new Uint8Array(Buffer.from(MESSAGE_HEX.slice(2), 'hex'));
const ATTESTATION = new Uint8Array(Buffer.from(ATTESTATION_HEX.slice(2), 'hex'));
/** The devnet token messenger account (`AawthJ…g58W`) as fetched on 2026-10-10. */
const TOKEN_MESSENGER_DATA =
  'ogTyNJPz3WCAxc+QtIgKaKCt4UH53aPJt3kR23C3Hek9+WiJv/bN7IDFz5C0iApooK3hQfndo8m3eRHbcLcd6T35aIm/9s3sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAA/o27Pw20uiv5lMc+pRYLtM5pPc2D8SnZcwyLyxyQpT3IgMXPkLSICmigreFB+d2jybd5Edtwtx3pPfloib/2zewAAAAA';
/** Accounts of the instruction in the mint transaction above, from the second one on (the first two are the relayer). */
const MINT_TX_ACCOUNTS = [
  'DsAdX23SVpTPYhKP2ua1mx8gTPqLyzx7a43cyxYjS2up',
  'W1k5ijkaSTo5iA5zChNpfzcy796fLhkBxfmJuR8W8HU',
  'EsGQzKG3Ey9U6WSDrqZgqDKgzNapkr3k6Jm6xiBdtNWX',
  'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
  '11111111111111111111111111111111',
  '2PcXTomVAbX5Es1NUZUkxwuCm8tvV4NmRk3fmQWFCWoV',
  'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC',
  'AawthJCGRmggpfv9MMWV6Jmo9cue4gL9wUZgRBShg58W',
  '2mfHPyiRdSkp2dJxmhMPvhfZCPDKDtzPQ5GUj1YB8n18',
  'E1bQJ8eMMn3zmeSewW3HQ8zmJr7KR75JonbwAtWx2bux',
  '7MwmWTK2R9Na6rnoSAEt5gytFmSZj9WLVdazvxvru9AU',
  'FekqRSqWBeQGvmhZ2zV5oYDMWPfKu8h8YnXGJFeSw5gh',
  '2cDia1Ga9XDBGWVyFmaqiE7FKMDEtcy3xoRCW7B7S4es',
  '8FF1ZT34YYkrNrJitAHwzB3eP9nsKdFdctGqxkwupUGg',
  'CFUgYpbas5UdJkwwSobYgzhFqFuj6C8MfXwBetE3o4SY',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  '6TCCnJ9R1m1RXFzyoH7GYH2J6NJDtZaUvfipPuLWxHNd',
  'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe',
];

function serving(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

/** An RPC that serves one account and nothing else. */
function rpcWith(data: string | null, owner = 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe') {
  return {
    getAccountInfo: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: data === null ? null : { data: [data, 'base64'], executable: false, lamports: 1n, owner, space: 177n },
      }),
    }),
  } as unknown as Rpc<GetAccountInfoApi>;
}

describe('source chains', () => {
  it('enables Arc explicitly and keeps Base off until it is proven', () => {
    expect(parseEnabledChains('solana,arc')).toEqual(['solana', 'arc']);
    expect(() => parseEnabledChains('solana,base')).toThrow(/not available yet/);
    const config = createConfig({ enabledChains: ['solana', 'arc'] });
    expect(getCctpSourceChain(config, 'arc')).toMatchObject({ domain: 26, evmChainId: 5042002 });
    expect(() => getCctpSourceChain(config, 'solana')).toThrow(/not a cross-chain source/);
  });

  it('refuses chains that are not enabled, and localnet', () => {
    expect(() => getCctpSourceChain(createConfig(), 'arc')).toThrow(OpaqConfigError);
    expect(() => getCctpSourceChain(createConfig({ cluster: 'localnet', enabledChains: ['solana', 'arc'] }), 'arc')).toThrow(/localnet/);
  });
});

describe('before the burn', () => {
  it('derives a one-time address and names its token account as mint recipient', async () => {
    const relayer = await generateKeyPairSigner();
    const keys = generateMetaKeys();
    const prepared = await getPrepareCctpPaymentInstructions({ accountPayer: relayer, meta: keys, mint: USDC });
    expect(prepared.instructions).toHaveLength(1);
    expect(prepared.mintRecipient).toMatch(/^0x[0-9a-f]{64}$/);
    // The recipient is the token account, not the stealth address itself.
    expect(Buffer.from(prepared.mintRecipient.slice(2), 'hex')).not.toEqual(Buffer.from(keys.spendPubkey));
    expect(prepared.instructions[0]!.accounts!.map((a) => a.address)).toContain(prepared.stealthTokenAccount);
    expect(scanAnnouncement(keys.scanSeed, keys.spendPubkey, prepared.payment)).not.toBeNull();
  });

  it('quotes Fast Transfer when offered and rounds the fee up', async () => {
    const fast = serving([{ finalityThreshold: 1000, minimumFee: 1.3 }, { finalityThreshold: 2000, minimumFee: 0 }]);
    const quote = await fetchCctpTransferQuote(arc, 1_000_000n, fast);
    expect(fast.calls[0]).toBe('https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/26/5');
    expect(quote).toEqual({ maxFee: 130n, minFinalityThreshold: 1000 });
    expect((await fetchCctpTransferQuote(arc, 1n, fast)).maxFee).toBe(1n);

    const standard = serving([{ finalityThreshold: 2000, minimumFee: 0 }]);
    expect(await fetchCctpTransferQuote(arc, 1_000_000n, standard)).toEqual({ maxFee: 0n, minFinalityThreshold: 2000 });
    await expect(fetchCctpTransferQuote(arc, 1n, serving([{ finalityThreshold: 1000, minimumFee: 'free' }]))).rejects.toThrow(/no fee quote/);
    await expect(fetchCctpTransferQuote(arc, 1n, serving({}, 500))).rejects.toThrow(/500/);
  });

  it('builds depositForBurn arguments for Solana with an open caller', () => {
    const mintRecipient = `0x${'ab'.repeat(32)}` as const;
    const args = getCctpDepositForBurnArgs({ source: arc, amount: 1_000_000n, mintRecipient, quote: { maxFee: 130n, minFinalityThreshold: 1000 } });
    expect(args).toEqual([1_000_000n, CCTP_SOLANA_DOMAIN, mintRecipient, arc.usdc, `0x${'00'.repeat(32)}`, 130n, 1000]);
    expect(() => getCctpDepositForBurnArgs({ source: arc, amount: 100n, mintRecipient, quote: { maxFee: 100n, minFinalityThreshold: 1000 } })).toThrow(/fee/);
    expect(() => getCctpDepositForBurnArgs({ source: arc, amount: 1n, mintRecipient: '0x1234', quote: { maxFee: 0n, minFinalityThreshold: 2000 } })).toThrow(/32 bytes/);
  });
});

describe('after the burn', () => {
  it('decodes a real burn message', () => {
    const decoded = decodeCctpBurnMessage(MESSAGE);
    expect(decoded).toMatchObject({
      sourceDomain: 26,
      destinationDomain: 5,
      minFinalityThreshold: 1000,
      finalityThresholdExecuted: 2000,
      mintRecipient: '8FF1ZT34YYkrNrJitAHwzB3eP9nsKdFdctGqxkwupUGg',
      amount: 1_000_000n,
      maxFee: 0n,
      feeExecuted: 0n,
    });
    expect(Buffer.from(decoded.burnToken).toString('hex')).toBe(arc.usdc.slice(2).padStart(64, '0'));
  });

  it('rejects truncated messages and messages for another receiver', () => {
    expect(() => decodeCctpBurnMessage(MESSAGE.subarray(0, 300))).toThrow(/too short/);
    const otherReceiver = MESSAGE.slice();
    otherReceiver[80]! ^= 1;
    expect(() => decodeCctpBurnMessage(otherReceiver)).toThrow(/token messenger/);
    const otherVersion = MESSAGE.slice();
    otherVersion[3] = 0;
    expect(() => decodeCctpBurnMessage(otherVersion)).toThrow(/V2/);
  });

  it('reads an attestation and treats pending or missing ones as not ready', async () => {
    const ready = serving({ messages: [{ status: 'complete', message: MESSAGE_HEX, attestation: ATTESTATION_HEX }] });
    const attested = await fetchCctpAttestation(arc, BURN_TX, ready);
    expect(ready.calls[0]).toBe(`https://iris-api-sandbox.circle.com/v2/messages/26?transactionHash=${BURN_TX}`);
    expect(attested!.message).toEqual(MESSAGE);
    expect(attested!.attestation).toHaveLength(130);

    expect(await fetchCctpAttestation(arc, BURN_TX, serving({}, 404))).toBeNull();
    const pending = serving({ messages: [{ status: 'pending_confirmations', message: MESSAGE_HEX, attestation: 'PENDING' }] });
    expect(await fetchCctpAttestation(arc, BURN_TX, pending)).toBeNull();
    await expect(fetchCctpAttestation(arc, BURN_TX, serving({ messages: [{ status: 'complete', message: 'nope', attestation: '0x' }] }))).rejects.toThrow(/Malformed/);
    await expect(fetchCctpAttestation(arc, '0x1234', ready)).rejects.toThrow(/transaction hash/);
  });

  it('builds receive_message with the accounts of the real mint transaction', async () => {
    const relayer = await generateKeyPairSigner();
    const instruction = await getCctpReceiveMessageInstruction(rpcWith(TOKEN_MESSENGER_DATA), {
      payer: relayer,
      message: MESSAGE,
      attestation: ATTESTATION,
      mint: USDC,
    });
    expect(instruction.programAddress).toBe(CCTP_MESSAGE_TRANSMITTER_PROGRAM_ADDRESS);
    expect(instruction.accounts.slice(0, 2).map((a) => [a.address, a.role])).toEqual([
      [relayer.address, AccountRole.WRITABLE_SIGNER],
      [relayer.address, AccountRole.READONLY_SIGNER],
    ]);
    expect(instruction.accounts.slice(2).map((a) => a.address)).toEqual(MINT_TX_ACCOUNTS);
    // Only the relayer signs: nothing else in the instruction can be made to pay or authorise.
    expect(instruction.accounts.filter((a) => a.role === AccountRole.WRITABLE_SIGNER || a.role === AccountRole.READONLY_SIGNER)).toHaveLength(2);
    // It is the payer and the caller, and is not among the accounts handed on to the receiver.
    expect(instruction.accounts.slice(2).some((a) => a.address === relayer.address)).toBe(false);
    expect(instruction.data).toHaveLength(8 + 4 + MESSAGE.length + 4 + ATTESTATION.length);
  });

  it('knows whether a message was already delivered', async () => {
    expect(await findCctpUsedNoncePda(MESSAGE)).toBe(MINT_TX_ACCOUNTS[2]);
    expect(await isCctpMessageReceived(rpcWith(null), MESSAGE)).toBe(false);
    expect(await isCctpMessageReceived(rpcWith('AA=='), MESSAGE)).toBe(true);
  });

  it('refuses a token messenger account it cannot trust', async () => {
    const relayer = await generateKeyPairSigner();
    const input = { payer: relayer, message: MESSAGE, attestation: ATTESTATION, mint: USDC };
    await expect(getCctpReceiveMessageInstruction(rpcWith(null), input)).rejects.toThrow(/token messenger/);
    await expect(getCctpReceiveMessageInstruction(rpcWith(TOKEN_MESSENGER_DATA, '11111111111111111111111111111111'), input)).rejects.toThrow(/token messenger/);
    const wrongType = Buffer.from(TOKEN_MESSENGER_DATA, 'base64');
    wrongType[0]! ^= 1;
    await expect(getCctpReceiveMessageInstruction(rpcWith(wrongType.toString('base64')), input)).rejects.toThrow(/token messenger/);
  });

  it('announces with the relayer as announcer', async () => {
    const relayer = await generateKeyPairSigner();
    const keys = generateMetaKeys();
    const { payment } = await getPrepareCctpPaymentInstructions({ accountPayer: relayer, meta: keys, mint: USDC });
    const announce = await getCctpAnnounceInstruction({ announcer: relayer, payment, programs: DEVNET_PROGRAMS });
    expect(announce.programAddress).toBe(DEVNET_PROGRAMS.registry);
    expect(announce.accounts![0]).toMatchObject({ address: relayer.address, role: AccountRole.READONLY_SIGNER });
  });
});

describe('throwaway signers', () => {
  it('are different every time and sign like any ed25519 key', async () => {
    const a = createThrowawaySigner();
    const b = createThrowawaySigner();
    expect(a.address).not.toBe(b.address);
    const messageBytes = new Uint8Array([1, 2, 3]);
    const [signatures] = await a.signTransactions([{ messageBytes, signatures: {} } as never]);
    expect(verifySignature(new Uint8Array(signatures![a.address]!), messageBytes, a.address)).toBe(true);
  });
});
