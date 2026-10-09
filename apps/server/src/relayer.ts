/**
 * The relayer: adds its fee-payer signature to client-built transactions (sweeps, shielding,
 * unshielding, cash-out, close) so stealth addresses never need SOL.
 *
 * It signs a transaction only if, in order:
 *  1. the static checks in `checkRelayPolicy` pass: relayer is fee payer and nothing else it
 *     could be made to authorise moves its funds anywhere but back to itself; only Opaq-flow
 *     programs and instructions; every other signature present and valid;
 *  2. a simulation succeeds and costs the relayer at most `maxLamportsPerTransaction`;
 *  3. the rolling 24-hour spend stays under `dailyLamportBudget`;
 *  4. the client is under its per-minute rate limit (checked first, before any RPC).
 *
 * The relayer must hold SOL only. Rent it fronts (wrapper accounts, proof accounts) comes
 * back through closes that the policy forces to pay the relayer.
 */
import { vault, type OpaqPrograms } from '@opaq/sdk';
import {
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
  verifySignature,
  type Address,
  type Base64EncodedWireTransaction,
  type Blockhash,
  type GetBalanceApi,
  type GetSignatureStatusesApi,
  type IsBlockhashValidApi,
  type KeyPairSigner,
  type Rpc,
  type SendTransactionApi,
  type Signature,
  type SignatureBytes,
  type SimulateTransactionApi,
  type Transaction,
} from '@solana/kit';
import type { Db } from './db.js';

export const PROGRAMS = {
  system: '11111111111111111111111111111111',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  zkElGamalProof: 'ZkE1Gama1Proof11111111111111111111111111111',
} as const;

const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_2022_REALLOCATE = 29;
const SYSTEM_CREATE_ACCOUNT = 0;
const ZK_CLOSE_CONTEXT_STATE = 0;
const COMPUTE_SET_UNIT_PRICE = 3;
/** Priority fee cap, micro-lamports per compute unit. */
const MAX_COMPUTE_UNIT_PRICE = 10_000n;

export type RelayPolicy = {
  relayer: Address;
  programs: OpaqPrograms;
};

export type PolicyResult = { ok: true; blockhash: Blockhash; signatureCount: number } | { ok: false; reason: string };

const equalBytes = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length >= b.length && Array.from(b).every((byte, i) => a[i] === byte);

/** Static checks on a decoded transaction. Pure; no RPC. */
export async function checkRelayPolicy(transaction: Transaction, policy: RelayPolicy): Promise<PolicyResult> {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.version !== 'legacy' && message.version !== 0) return { ok: false, reason: 'unsupported message version' };
  if ('addressTableLookups' in message && (message.addressTableLookups?.length ?? 0) > 0) {
    return { ok: false, reason: 'address lookup tables are not accepted' };
  }
  const accounts = message.staticAccounts;
  if (accounts[0] !== policy.relayer) return { ok: false, reason: 'relayer must be the fee payer' };

  // Signatures: the relayer's slot empty, every other signer present and valid.
  for (let i = 0; i < message.header.numSignerAccounts; i++) {
    const signer = accounts[i]!;
    const signature = transaction.signatures[signer];
    const empty = !signature || signature.every((byte) => byte === 0);
    if (signer === policy.relayer) {
      if (!empty) return { ok: false, reason: 'relayer signature slot must be empty' };
      continue;
    }
    if (empty) return { ok: false, reason: `missing signature for ${signer}` };
    if (!(await verifySignature(await getPublicKeyFromAddress(signer), signature as SignatureBytes, transaction.messageBytes))) {
      return { ok: false, reason: `invalid signature for ${signer}` };
    }
  }

  const allowed = new Set<string>([...Object.values(PROGRAMS), policy.programs.vault]);
  for (const [index, instruction] of message.instructions.entries()) {
    const program = accounts[instruction.programAddressIndex];
    if (!program || !allowed.has(program)) return { ok: false, reason: `instruction ${index}: program ${program} not allowed` };
    const data = instruction.data ?? new Uint8Array();
    const ixAccounts = (instruction.accountIndices ?? []).map((i) => accounts[i]);
    if (ixAccounts.some((a) => a === undefined)) return { ok: false, reason: `instruction ${index}: bad account index` };
    const relayerAt = ixAccounts.flatMap((a, i) => (a === policy.relayer ? [i] : []));
    const fail = (why: string): PolicyResult => ({ ok: false, reason: `instruction ${index}: ${why}` });

    switch (program) {
      case PROGRAMS.computeBudget: {
        if (data[0] === COMPUTE_SET_UNIT_PRICE) {
          const price = new DataView(data.buffer, data.byteOffset + 1, 8).getBigUint64(0, true);
          if (price > MAX_COMPUTE_UNIT_PRICE) return fail('priority fee too high');
        }
        break;
      }
      case PROGRAMS.system: {
        // Only creating proof context-state accounts (owned by the ZK program) may spend relayer SOL.
        const kind = data.length >= 4 ? new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) : -1;
        if (kind !== SYSTEM_CREATE_ACCOUNT || data.length !== 52) return fail('only CreateAccount is allowed');
        const owner = getAddressDecoder().decode(data.slice(20, 52));
        if (owner !== PROGRAMS.zkElGamalProof) return fail('CreateAccount must be for a ZK proof context account');
        if (relayerAt.some((i) => i !== 0)) return fail('relayer may only fund the account');
        break;
      }
      case PROGRAMS.associatedToken: {
        // Relayer may pay for an ATA, never own one.
        if (relayerAt.some((i) => i !== 0)) return fail('relayer may only be the ATA payer');
        break;
      }
      case PROGRAMS.token:
      case PROGRAMS.token2022: {
        if (data[0] === TOKEN_CLOSE_ACCOUNT) {
          if (ixAccounts[1] !== policy.relayer) return fail('closed accounts must refund the relayer');
          if (relayerAt.some((i) => i !== 1)) return fail('relayer may not own closed accounts');
        } else if (program === PROGRAMS.token2022 && data[0] === TOKEN_2022_REALLOCATE) {
          if (relayerAt.some((i) => i !== 1)) return fail('relayer may only pay for reallocation');
        } else if (relayerAt.length > 0) {
          return fail('relayer may not take part in token instructions');
        }
        break;
      }
      case PROGRAMS.zkElGamalProof: {
        if (data[0] === ZK_CLOSE_CONTEXT_STATE && ixAccounts[1] !== policy.relayer) {
          return fail('closed proof accounts must refund the relayer');
        }
        break;
      }
      case policy.programs.vault: {
        const isDeposit = equalBytes(data, vault.DEPOSIT_DISCRIMINATOR);
        const isWithdraw = equalBytes(data, vault.WITHDRAW_DISCRIMINATOR);
        if (!isDeposit && !isWithdraw) return fail('only vault deposit and withdraw are relayed');
        if (relayerAt.length > 0) return fail('relayer may not take part in vault instructions');
        break;
      }
    }
  }
  return { ok: true, blockhash: message.lifetimeToken as Blockhash, signatureCount: message.header.numSignerAccounts };
}

export type RelayerRpc = Rpc<
  SimulateTransactionApi & SendTransactionApi & GetSignatureStatusesApi & IsBlockhashValidApi & GetBalanceApi
>;

/** True for HTTP 429 from the RPC, anywhere in the error's `cause` chain. */
export function isRateLimited(error: unknown): boolean {
  for (let e = error as { message?: string; context?: { statusCode?: number }; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.context?.statusCode === 429 || /\b429\b|Too Many Requests/.test(e.message ?? '')) return true;
  }
  return false;
}

/** Retries an RPC call on 429 with exponential backoff (public endpoints rate-limit per method). */
export async function withRpcRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimited(error) || i + 1 >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** i));
    }
  }
}

export class RelayError extends Error {
  constructor(
    readonly status: 400 | 429 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

/** Fixed-window per-client limiter. Per process: put a shared limiter in front when scaling out. */
export function createRateLimiter(perMinute: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (client: string, now = Date.now()): boolean => {
    const window = windows.get(client);
    if (!window || now - window.start >= 60_000) {
      windows.set(client, { start: now, count: 1 });
      if (windows.size > 100_000) windows.clear(); // bound memory under abuse
      return true;
    }
    window.count++;
    return window.count <= perMinute;
  };
}

export function createRelayer(options: {
  rpc: RelayerRpc;
  db: Db;
  signer: KeyPairSigner;
  programs: OpaqPrograms;
  maxLamportsPerTransaction: bigint;
  dailyLamportBudget: bigint;
  requestsPerMinute: number;
  /** How long to wait for confirmation before giving up. */
  confirmTimeoutMs?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}) {
  const limiter = createRateLimiter(options.requestsPerMinute);
  const log = options.log ?? (() => {});
  const policy: RelayPolicy = { relayer: options.signer.address, programs: options.programs };

  async function spentToday(): Promise<bigint> {
    const { rows } = await options.db.query<{ total: string | null }>(
      "select sum(lamport_cost)::text as total from relay_log where created_at > now() - interval '24 hours'",
    );
    return BigInt(rows[0]?.total ?? '0');
  }

  async function confirm(signature: Signature, wire: Base64EncodedWireTransaction, blockhash: Blockhash) {
    const deadline = Date.now() + (options.confirmTimeoutMs ?? 60_000);
    let lastSend = Date.now();
    while (Date.now() < deadline) {
      let status;
      try {
        ({ value: [status] } = await withRpcRetry(() => options.rpc.getSignatureStatuses([signature]).send()));
      } catch (error) {
        if (!isRateLimited(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue; // still landing or not; keep waiting until the deadline
      }
      if (status?.err) throw new RelayError(400, `transaction failed: ${JSON.stringify(status.err, (_, v) => (typeof v === 'bigint' ? String(v) : v))}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
      if (!status) {
        const { value: valid } = await withRpcRetry(() => options.rpc.isBlockhashValid(blockhash, { commitment: 'confirmed' }).send());
        if (!valid) throw new RelayError(400, 'blockhash expired before the transaction landed');
        if (Date.now() - lastSend > 3000) {
          await withRpcRetry(() => options.rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: true, maxRetries: 0n }).send());
          lastSend = Date.now();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new RelayError(503, 'timed out waiting for confirmation');
  }

  /** Validates, signs, sends and confirms. Throws `RelayError` with an HTTP status. */
  async function relay(wireBase64: string, client: string): Promise<Signature> {
    if (!limiter(client)) throw new RelayError(429, 'rate limit exceeded');

    let transaction: Transaction;
    try {
      const bytes = Uint8Array.from(Buffer.from(wireBase64, 'base64'));
      if (bytes.length === 0 || bytes.length > 1232) throw new Error('size');
      transaction = getTransactionDecoder().decode(bytes);
    } catch {
      throw new RelayError(400, 'malformed transaction');
    }

    const checked = await checkRelayPolicy(transaction, policy);
    if (!checked.ok) throw new RelayError(400, checked.reason);

    // Ed25519 signatures are deterministic, so signing first gives the signature this
    // transaction will have. If it already landed (a client retry after a timeout or 503),
    // answer with it instead of failing on "already processed". Nothing is sent before the
    // checks below pass.
    const signed = await partiallySignTransaction([options.signer.keyPair], transaction);
    const wire = getBase64EncodedWireTransaction(signed);
    const signature = getSignatureFromTransaction(signed);
    const {
      value: [existing],
    } = await withRpcRetry(() => options.rpc.getSignatureStatuses([signature], { searchTransactionHistory: false }).send());
    if (existing && !existing.err && existing.confirmationStatus !== 'processed') {
      log('relay retried for a landed transaction', { signature });
      return signature;
    }

    // Simulate (relayer signature still missing, so no sig verification) and measure what
    // the relayer's account would lose. Fees are charged on top of the simulated state.
    const unsigned = getBase64EncodedWireTransaction(transaction);
    const [{ value: before }, simulation] = await Promise.all([
      withRpcRetry(() => options.rpc.getBalance(policy.relayer, { commitment: 'confirmed' }).send()),
      withRpcRetry(() =>
        options.rpc
          .simulateTransaction(unsigned, {
            encoding: 'base64',
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: 'confirmed',
            accounts: { addresses: [policy.relayer], encoding: 'base64' },
          })
          .send(),
      ),
    ]);
    if (simulation.value.err) {
      throw new RelayError(400, `simulation failed: ${JSON.stringify(simulation.value.err, (_, v) => (typeof v === 'bigint' ? String(v) : v))}`);
    }
    const after = simulation.value.accounts?.[0]?.lamports ?? before;
    const fee = 5000n * BigInt(checked.signatureCount);
    const cost = before - after + fee;
    if (cost > options.maxLamportsPerTransaction) throw new RelayError(400, `transaction would cost the relayer ${cost} lamports`);
    if ((await spentToday()) + (cost > 0n ? cost : 0n) > options.dailyLamportBudget) {
      throw new RelayError(503, 'relayer daily budget exhausted');
    }

    try {
      await withRpcRetry(() => options.rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: true, maxRetries: 0n }).send());
    } catch (error) {
      throw new RelayError(502, `send failed: ${String(error)}`);
    }
    await options.db.query('insert into relay_log (signature, client, lamport_cost) values ($1, $2, $3)', [
      signature,
      client,
      cost.toString(),
    ]);
    await confirm(signature, wire, checked.blockhash);
    log('relayed', { signature, cost: cost.toString() });
    return signature;
  }

  return { address: policy.relayer, relay };
}

export type Relayer = ReturnType<typeof createRelayer>;
