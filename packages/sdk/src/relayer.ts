/**
 * Sending through an Opaq relayer (`apps/server`). The relayer is the fee payer and pays
 * temporary rent; the client builds and partially signs every transaction (stealth signer,
 * proof-account keypairs) and the relayer only adds its fee-payer signature after checking
 * that the transaction cannot cost it more than its policy allows.
 *
 * Privacy: the relayer sees which stealth accounts one client sends for (and its IP). Use
 * Opaq's shared relayer, not one funded from the recipient's wallet.
 */
import {
  createNoopSigner,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  getBase64EncodedWireTransaction,
  isAddress,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type GetLatestBlockhashApi,
  type InstructionPlan,
  type Rpc,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';

export type RelayerClient = {
  getAddress(): Promise<Address>;
  /** Submits a partially signed transaction (base64 wire format); resolves once confirmed. */
  relay(wireTransaction: string): Promise<Signature>;
};

export class RelayerRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Relayer rejected the transaction (${status}): ${reason}`);
    this.name = 'RelayerRejectedError';
  }
}

/**
 * `retries`: how often to retry a relay the server answered with 429/503 (rate limits, upstream
 * RPC trouble). Safe because the relayer is idempotent: a transaction that already landed is
 * answered with its signature. Default 4, with exponential backoff from 1 s.
 */
export function createRelayerClient(options: { url: string; fetch?: typeof fetch; retries?: number }): RelayerClient {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  let address: Address | undefined;
  return {
    async getAddress() {
      if (address) return address;
      const response = await doFetch(`${base}/v1/relayer`);
      if (!response.ok) throw new Error(`Relayer error ${response.status}`);
      const body = (await response.json()) as { address?: unknown };
      if (typeof body.address !== 'string' || !isAddress(body.address)) throw new Error('Malformed relayer response');
      address = body.address;
      return address;
    },
    async relay(wireTransaction) {
      const retries = options.retries ?? 4;
      for (let attempt = 0; ; attempt++) {
        const response = await doFetch(`${base}/v1/relay`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ transaction: wireTransaction }),
        });
        const body = (await response.json().catch(() => ({}))) as { signature?: unknown; error?: unknown };
        if (response.ok) {
          if (typeof body.signature !== 'string') throw new Error('Malformed relayer response');
          return body.signature as Signature;
        }
        const retryable = response.status === 429 || response.status === 503;
        if (!retryable || attempt >= retries) throw new RelayerRejectedError(response.status, String(body.error ?? 'unknown'));
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    },
  };
}

/**
 * A stand-in signer for the relayer's address. Pass it wherever an SDK helper asks for a
 * `payer`/`accountPayer`; the relayer adds the real signature server-side.
 */
export async function getRelayerSigner(relayer: RelayerClient): Promise<TransactionSigner> {
  return createNoopSigner(await relayer.getAddress());
}

/**
 * Runs an instruction plan through the relayer, transaction by transaction, in order.
 * Returns the signatures. Build the plan with `getRelayerSigner(relayer)` as payer.
 */
export async function sendPlanViaRelayer(input: {
  rpc: Rpc<GetLatestBlockhashApi>;
  relayer: RelayerClient;
  plan: InstructionPlan;
}): Promise<Signature[]> {
  const feePayer = await getRelayerSigner(input.relayer);
  const signatures: Signature[] = [];
  const planner = createTransactionPlanner({
    createTransactionMessage: async () => {
      const { value: latestBlockhash } = await input.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      return pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
      );
    },
  });
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (_context, message) => {
      const transaction = await partiallySignTransactionMessageWithSigners(message);
      const signature = await input.relayer.relay(getBase64EncodedWireTransaction(transaction));
      signatures.push(signature);
      return { signature };
    },
  });
  await executor(await planner(input.plan));
  return signatures;
}
