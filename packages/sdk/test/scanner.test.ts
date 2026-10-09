import { address, getBase58Decoder, generateKeyPairSigner, type Signature } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  EVENT_IX_TAG,
  extractAnnouncements,
  fetchAnnouncements,
  findEventAuthorityPda,
  registry,
  type ScanRpc,
  type TransactionLike,
} from '../src/index.js';

/** Some other deployment (the first devnet one), to check that builders follow `programs`. */
const OTHER_PROGRAMS = {
  registry: address('6xaXX6KSFxkNohbanstr2Sqpk3teRUExuLQ1u1ndcEyE'),
  vault: address('JHC14FJWJWAkLNj4aDe1EPr65ideg4tSoZmrdXuZtPA'),
};


const base58 = getBase58Decoder();

async function eventData(viewTag: number) {
  const body = registry.getAnnouncementEventEncoder().encode({
    ephemeralPubkey: new Uint8Array(32).fill(7),
    stealthAddress: (await generateKeyPairSigner()).address,
    viewTag,
    announcer: (await generateKeyPairSigner()).address,
  });
  return base58.decode(new Uint8Array([...EVENT_IX_TAG, ...body]));
}

async function announceTx(overrides: { err?: unknown; program?: string; authority?: string } = {}) {
  const eventAuthority = await findEventAuthorityPda(OTHER_PROGRAMS.registry);
  const other = (await generateKeyPairSigner()).address;
  const keys = [other, overrides.program ?? OTHER_PROGRAMS.registry, overrides.authority ?? eventAuthority];
  const tx: TransactionLike = {
    transaction: { message: { accountKeys: keys } },
    meta: {
      err: overrides.err ?? null,
      innerInstructions: [{ instructions: [{ programIdIndex: 1, accounts: [2], data: await eventData(5) }] }],
    },
  };
  return tx;
}

describe('extractAnnouncements', () => {
  it('reads the registry’s own event CPI', async () => {
    const found = await extractAnnouncements(await announceTx(), OTHER_PROGRAMS);
    expect(found).toHaveLength(1);
    expect(found[0]!.viewTag).toBe(5);
  });

  it('ignores failed transactions, other programs, wrong authority and junk data', async () => {
    expect(await extractAnnouncements(await announceTx({ err: { InstructionError: [0, 'Custom'] } }), OTHER_PROGRAMS)).toEqual([]);
    const stranger = (await generateKeyPairSigner()).address;
    expect(await extractAnnouncements(await announceTx({ program: stranger }), OTHER_PROGRAMS)).toEqual([]);
    expect(await extractAnnouncements(await announceTx({ authority: stranger }), OTHER_PROGRAMS)).toEqual([]);
    // Same transaction read against the default (local/devnet) registry finds nothing.
    expect(await extractAnnouncements(await announceTx())).toEqual([]);

    const junk = await announceTx();
    junk.meta!.innerInstructions![0]!.instructions[0]!.data = '0OIl'; // not base58
    expect(await extractAnnouncements(junk, OTHER_PROGRAMS)).toEqual([]);
  });

  it('resolves accounts loaded from lookup tables', async () => {
    const eventAuthority = await findEventAuthorityPda(OTHER_PROGRAMS.registry);
    const tx: TransactionLike = {
      transaction: { message: { accountKeys: [(await generateKeyPairSigner()).address] } },
      meta: {
        err: null,
        loadedAddresses: { writable: [], readonly: [OTHER_PROGRAMS.registry, eventAuthority] },
        innerInstructions: [{ instructions: [{ programIdIndex: 1, accounts: [2], data: await eventData(9) }] }],
      },
    };
    expect(await extractAnnouncements(tx, OTHER_PROGRAMS)).toHaveLength(1);
  });
});

describe('fetchAnnouncements', () => {
  it('queries the event authority, skips failed signatures and returns oldest first', async () => {
    const queried: string[] = [];
    const transactions = new Map<string, TransactionLike>();
    const sigs = ['s3', 's2', 's1'] as unknown as Signature[]; // newest first, like the RPC
    transactions.set('s3', await announceTx());
    transactions.set('s1', await announceTx());
    const rpc = {
      getSignaturesForAddress: (address: string) => {
        queried.push(address);
        return {
          send: async () => [
            { signature: sigs[0], slot: 3n, blockTime: 30n, err: null },
            { signature: sigs[1], slot: 2n, blockTime: 20n, err: { InstructionError: [0, 'x'] } },
            { signature: sigs[2], slot: 1n, blockTime: null, err: null },
          ],
        };
      },
      getTransaction: (signature: string) => ({ send: async () => transactions.get(signature) ?? null }),
    } as unknown as ScanRpc;

    const page = await fetchAnnouncements(rpc, { programs: OTHER_PROGRAMS, limit: 3 });
    expect(queried).toEqual([await findEventAuthorityPda(OTHER_PROGRAMS.registry)]);
    expect(page.items.map((item) => item.signature)).toEqual(['s1', 's3']);
    expect(page.items[0]!.blockTime).toBeNull();
    expect(page.items[1]!.blockTime).toBe(30);
    expect(page.newestSignature).toBe('s3');
    expect(page.oldestSignature).toBe('s1');
    expect(page.mayHaveMore).toBe(true);
  });
});
