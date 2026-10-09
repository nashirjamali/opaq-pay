# ADR 0002: Indexer and relayer service (`apps/server`)

Date: 2026-10-09. Status: accepted.

## Context

Scanning over RPC costs one `getTransaction` per announcement in the whole system, for every
recipient, and the public RPC rate-limits at a few dozen payments. Stealth addresses hold no
SOL, so every post-payment transaction needs someone else as fee payer. A relayer funded from
the recipient's wallet links that wallet to every account it serves.

## Decision

`apps/server` (Hono + Postgres, one process, horizontally scalable for reads):

- **Indexer.** Polls `getSignaturesForAddress` on the registry's event-authority PDA, stores
  announcements with the cursor in one DB transaction (`finalized` by default), idempotent on
  `(signature, ix_index)`. `GET /v1/announcements?after=&limit=` serves *all* announcements by
  insertion id; full pages are immutable and CDN-cacheable. Clients match locally
  (`scanIndexerForPayments`), so the server never learns whose payment is whose.
- **Relayer.** `POST /v1/relay` takes a client-built, partially signed transaction with the
  relayer as fee payer (`sendPlanViaRelayer`, `getRelayerSigner`). It signs only if: the static
  policy passes (allowed programs; relayer appears only as fee payer, ATA/reallocation/proof-account
  funder, or refund destination of closes; only vault deposit/withdraw; all other signatures
  valid; no lookup tables; capped priority fee), simulation succeeds and costs it at most
  `RELAYER_MAX_LAMPORTS_PER_TX`, the rolling 24 h spend stays under `RELAYER_DAILY_LAMPORT_BUDGET`,
  and the client is under `RELAYER_REQUESTS_PER_MINUTE`. The relayer key holds SOL only.
- One shared Opaq relayer for all recipients, funded from a treasury unrelated to any user.

## Consequences

- Recipients catch up with one cursor; balances come from their own RPC in batches of 100.
- The indexer can withhold announcements (censor) but not forge ownership; clients can
  cross-check with `scanForPayments` over RPC.
- The relayer sees which stealth accounts one client (IP/session) works on, so it can cluster
  a recipient's payments. It is a trusted party for privacy, not only for liveness. Mitigations
  (several relayers, batching, Tor) are future work.
- Fronted rent comes back through closes the policy forces to refund the relayer; ATAs it pays
  for third parties (cash-out addresses) are a real cost, bounded by the caps.
- Rate limiting is per process; put a shared limiter (or the edge) in front when scaling out.
- Polling can be complemented by RPC webhooks later; ingestion is already idempotent.
