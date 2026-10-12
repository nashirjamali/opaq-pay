/**
 * The wallet sponsor: sends a small, fixed amount of SOL to a new wallet, once per address, so it can
 * register its handle (`register_handle` makes the owner pay the rent, which a relayer cannot do).
 *
 * It uses its own key, not the relayer's: the relayer pays for stealth addresses, and its history must
 * never mention a recipient wallet. Test networks only (enforced in `loadServerConfig`).
 *
 * Limits, checked in order: a per-client rate limit; the address is valid and holds less than the
 * grant; it was never sponsored before; the rolling 24-hour grants stay under the daily budget.
 */
import { getBase64EncodedWireTransaction, getU32Encoder, getU64Encoder, isAddress, type Address } from '@solana/kit';
import {
  AccountRole,
  appendTransactionMessageInstruction,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type GetBalanceApi,
  type GetLatestBlockhashApi,
  type GetSignatureStatusesApi,
  type KeyPairSigner,
  type Rpc,
  type SendTransactionApi,
} from '@solana/kit';
import type { Db } from './db.js';
import { createRateLimiter, RelayError, withRpcRetry } from './relayer.js';

const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
const SYSTEM_TRANSFER = 2;

export type SponsorRpc = Rpc<GetBalanceApi & GetLatestBlockhashApi & SendTransactionApi & GetSignatureStatusesApi>;

export function createSponsor(options: {
  rpc: SponsorRpc;
  db: Db;
  signer: KeyPairSigner;
  lamportsPerWallet: bigint;
  dailyLamportBudget: bigint;
  requestsPerMinute: number;
  confirmTimeoutMs?: number;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}) {
  const limiter = createRateLimiter(options.requestsPerMinute);
  const log = options.log ?? (() => {});
  const { rpc, db, signer } = options;

  async function confirm(signature: string): Promise<void> {
    const deadline = Date.now() + (options.confirmTimeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      const { value } = await withRpcRetry(() => rpc.getSignatureStatuses([signature as never]).send());
      const status = value[0];
      if (status?.err) throw new RelayError(502, 'the transfer failed on chain');
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new RelayError(503, 'the transfer was sent but is not confirmed yet');
  }

  return {
    address: signer.address,

    async sponsor(address: unknown, client: string): Promise<{ signature: string; lamports: string }> {
      if (!limiter(client)) throw new RelayError(429, 'too many requests, slow down');
      if (typeof address !== 'string' || !isAddress(address)) throw new RelayError(400, 'expected { address }');
      const target = address as Address;

      const { value: balance } = await withRpcRetry(() => rpc.getBalance(target, { commitment: 'confirmed' }).send());
      if (balance >= options.lamportsPerWallet) throw new RelayError(400, 'this wallet already has enough SOL');

      const { rows } = await db.query<{ spent: string }>(
        `select coalesce(sum(lamports), 0)::text as spent from sponsor_log where created_at > now() - interval '24 hours'`,
      );
      if (BigInt(rows[0]?.spent ?? '0') + options.lamportsPerWallet > options.dailyLamportBudget) {
        throw new RelayError(503, 'the free SOL budget for today is used up, try again later');
      }

      // Claim the address before sending, so two requests cannot both pay it.
      const claim = await db.query(
        'insert into sponsor_log (address, lamports, client) values ($1, $2, $3) on conflict (address) do nothing returning id',
        [target, options.lamportsPerWallet.toString(), client],
      );
      if (claim.rowCount === 0) throw new RelayError(400, 'this wallet already received free SOL');

      try {
        const { value: latestBlockhash } = await withRpcRetry(() => rpc.getLatestBlockhash({ commitment: 'confirmed' }).send());
        const data = new Uint8Array([...getU32Encoder().encode(SYSTEM_TRANSFER), ...getU64Encoder().encode(options.lamportsPerWallet)]);
        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) =>
            appendTransactionMessageInstruction(
              {
                programAddress: SYSTEM_PROGRAM,
                accounts: [
                  { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
                  { address: target, role: AccountRole.WRITABLE },
                ],
                data,
              },
              m,
            ),
        );
        const transaction = await signTransactionMessageWithSigners(message);
        const signature = getSignatureFromTransaction(transaction);
        await withRpcRetry(() =>
          rpc.sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: 'base64', preflightCommitment: 'confirmed' }).send(),
        );
        await confirm(signature);
        await db.query('update sponsor_log set signature = $2 where address = $1', [target, signature]);
        log('sponsored', { address: target, lamports: options.lamportsPerWallet.toString(), signature });
        return { signature, lamports: options.lamportsPerWallet.toString() };
      } catch (error) {
        // Nothing arrived (or we cannot tell), so let the person try again.
        await db.query('delete from sponsor_log where address = $1 and signature is null', [target]).catch(() => {});
        throw error;
      }
    },
  };
}

export type Sponsor = ReturnType<typeof createSponsor>;
