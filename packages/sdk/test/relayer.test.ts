import { describe, expect, it } from 'vitest';
import { createRelayerClient, RelayerRejectedError } from '../src/index.js';

function relayerAnswering(...answers: { status: number; body: unknown }[]) {
  let calls = 0;
  const fetch = (async () => {
    const answer = answers[Math.min(calls++, answers.length - 1)]!;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof globalThis.fetch;
  return { client: createRelayerClient({ url: 'https://relayer.test', fetch, retries: 2 }), calls: () => calls };
}

describe('relayer client', () => {
  it('retries 503/429 (the relayer is idempotent) and returns the signature', async () => {
    const { client, calls } = relayerAnswering(
      { status: 503, body: { error: 'busy' } },
      { status: 200, body: { signature: 'sig' } },
    );
    expect(await client.relay('AAAA')).toBe('sig');
    expect(calls()).toBe(2);
  }, 10_000);

  it('does not retry policy rejections', async () => {
    const { client, calls } = relayerAnswering({ status: 400, body: { error: 'relayer must be the fee payer' } });
    const error = await client.relay('AAAA').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RelayerRejectedError);
    expect((error as RelayerRejectedError).reason).toMatch(/fee payer/);
    expect(calls()).toBe(1);
  });
});
