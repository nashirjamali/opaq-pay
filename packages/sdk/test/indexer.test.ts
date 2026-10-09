import { describe, expect, it } from 'vitest';
import { createIndexerClient, type AnnouncementJson } from '../src/index.js';

const good: AnnouncementJson = {
  signature: '5'.repeat(87),
  slot: '123',
  blockTime: 1_700_000_000,
  ephemeralPubkey: Buffer.alloc(32, 7).toString('base64'),
  stealthAddress: '9KwtkCZG7gBoCCVhZ3TKCWbiFcvTDnK87xGthhFAsRWh',
  viewTag: 5,
};

function serving(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, client: createIndexerClient({ url: 'https://indexer.test/', fetch }) };
}

describe('indexer client', () => {
  it('pages with a cursor and parses announcements', async () => {
    const { calls, client } = serving({ items: [good], next: '42', hasMore: true });
    const page = await client.fetchAnnouncements({ after: '41', limit: 10 });
    expect(calls[0]).toBe('https://indexer.test/v1/announcements?limit=10&after=41');
    expect(page.next).toBe('42');
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({ slot: 123n, viewTag: 5, stealthAddress: good.stealthAddress });
    expect(page.items[0]!.ephemeralPubkey).toHaveLength(32);
  });

  it('drops malformed items from an untrusted server instead of failing', async () => {
    const bad = [
      { ...good, stealthAddress: 'not-an-address' },
      { ...good, viewTag: 300 },
      { ...good, ephemeralPubkey: Buffer.alloc(31).toString('base64') },
      { ...good, slot: '-1' },
      null,
    ];
    const { client } = serving({ items: [...bad, good], next: '9', hasMore: false });
    expect((await client.fetchAnnouncements()).items).toHaveLength(1);
  });

  it('rejects error responses and non-list bodies', async () => {
    await expect(serving({}, 500).client.fetchAnnouncements()).rejects.toThrow(/500/);
    await expect(serving({ items: 'nope' }).client.fetchAnnouncements()).rejects.toThrow(/Malformed/);
  });
});
