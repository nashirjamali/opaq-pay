# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What Opaq is

Opaq is a private payments layer on Solana. Recipients (freelancers, creators, merchants) accept
stablecoins from any chain without exposing their wallet balance or history to the payer or the public,
and can still produce reports for accountants and auditors via viewing keys.

Three entry points share one protocol:

- **Opaq Link** – payment link / QR for freelancers and creators.
- **Opaq Checkout** – embeddable checkout widget for online stores.
- **Opaq SDK / API** – for platforms integrating private payments.

Full product description (ID + EN): https://claude.ai/code/artifact/39c1aa03-4581-429a-9de1-ef671ed584d1
"Opaq" is a working name.

## How it works (core flow)

1. Recipient registers a handle + stealth meta-address (scan key + spend key) in `opaq_registry`.
2. Payer opens a link/checkout; the SDK derives a one-time stealth address (ECDH, ERC-5564-style on ed25519)
   and announces the ephemeral public key via a program event.
3. Payment arrives: USDC transfer on Solana, or USDC burned on an EVM chain via Circle CCTP with the
   stealth address's Solana token account as recipient.
4. Recipient's client (or merchant server via SDK) scans with the scan key, derives the one-time key,
   and signs a sweep into `opaq_vault`. A relayer only pays fees.
5. `opaq_vault` holds USDC 1:1 and mints a Token-2022 confidential wrapper token (Confidential Transfer
   extension), or integrates Umbra/Arcium — decision pending (see Open decisions).
6. Viewing keys export decrypted balances/payments for a chosen time range.

## Repository layout (pnpm + Anchor monorepo)

```
programs/            Anchor programs: opaq_registry, opaq_vault (Rust)
apps/web/            Next.js app: payment page, recipient dashboard, Opaq Link
apps/server/         Node/TS backend: REST API, webhooks, relayer (fee payer), indexer/scanner
packages/sdk/        @opaq/sdk — TypeScript SDK (on a Codama-generated client + @solana/kit)
packages/checkout/   @opaq/checkout — React checkout widget
examples/demo-store/ Sample store integrating Opaq Checkout via the SDK
tests/               Integration tests (Surfpool); unit tests live next to each program/package
docs/                Design notes, ADRs, protocol spec
```

Most folders are still empty placeholders. Scaffold each one when work on it starts, and update this
file's Commands section at the same time.

## Stack

- Programs: Rust + Anchor (`anchor-cli` 1.x), Token-2022 Confidential Transfer extension.
- Clients: Codama-generated client from the Anchor IDL; `@solana/kit` (not legacy `@solana/web3.js`).
- Frontend: Next.js + `@solana/react`, embedded wallet with Google login, Phantom/Solflare support.
- Backend: Node.js (v24) + TypeScript (Hono or Express), Postgres, RPC webhooks for indexing.
- Cross-chain: Circle CCTP, Base as the first EVM source chain.
- Testing: LiteSVM / Mollusk for program unit tests, Surfpool for local integration.
- Package manager: pnpm workspaces.

## Commands

Programs (Anchor 1.1.2, Solana CLI 3.1.x, Rust toolchain pinned in `rust-toolchain.toml`):

- `NO_DNA=1 anchor build` – build both programs and IDLs (`target/deploy`, `target/idl`)
- `cargo test` – LiteSVM tests; they load the `.so` from `target/deploy`, so run `anchor build` first
- `cargo test -p opaq_registry` / `cargo test -p opaq_vault` – one program
- `cargo fmt --all` and `cargo clippy --all-targets` – keep both clean
- `NO_DNA=1 anchor keys sync` – align `declare_id!` and `Anchor.toml` with the keypairs in
  `target/deploy`. Program keypairs are gitignored; a fresh clone gets new local IDs from
  `anchor build` — do not commit ID changes made only for local testing.

JS workspaces (not scaffolded yet): `pnpm install`, `pnpm --filter <package> dev|build|test`.

## Programs

- `opaq_registry` – `register_handle`, `update_meta_address`, `announce`. Handle PDA:
  `["handle", name]`, names 3–32 chars of `a-z0-9_`. `announce` is stateless and emits the
  `Announcement` event via `emit_cpi!` (indexers read inner instructions, not logs).
- `opaq_vault` – `init_config`, `deposit`, `withdraw`, `set_fee`. Config PDA `["config"]` is the vault
  authority and wrapper mint authority; vault PDA `["vault", config]`. The wrapper mint is created
  client-side (Token-2022 + Confidential Transfer, no freeze authority, config as mint authority).
  Fee is taken on deposit in the underlying token, capped at `MAX_FEE_BPS = 100`. Invariant:
  vault balance == wrapper supply. Confidential deposit/transfer/withdraw of the wrapper token happen
  client-side against Token-2022, not in this program.
- Token-2022 `InterfaceAccount`s in instruction structs are `Box`ed to stay under the 4 KB BPF stack.

## Non-negotiable rules

- **Never custody user keys.** The spend key never leaves the recipient's device or server. The relayer
  is fee payer only and must not be able to redirect funds.
- **Not a mixer.** No shared anonymity pool that breaks fund origin. Everything stays traceable to
  viewing-key holders. Do not add features whose purpose is defeating auditability.
- **No new cryptography.** Use audited primitives (ed25519/ECDH, Token-2022 CT, CCTP, Umbra/Arcium).
  Any custom crypto code needs test vectors and review.
- **Fee caps are enforced on-chain** (protocol fee ≤ 1%). Admins cannot move vault funds.
- **Be honest about the privacy level** in UI and docs: payer address and the amount sent to a stealth
  address are public; deposits into `opaq_vault` are visible; timing can be correlated.
- Program code: validate every account (signer, `has_one`, mint), use checked math, emit events for
  every state change.
- Never commit secrets, keypairs, or `.env` files.

## Open decisions

- Private balance: own Token-2022 CT wrapper vs. Umbra/Arcium integration.
- First EVM chain: Base or Arbitrum.
- Protocol fee: 0.5% or 1%.
- Embedded wallet provider (Privy, Para, or Web3Auth).

Record decisions as short ADRs in `docs/` and update this file.
