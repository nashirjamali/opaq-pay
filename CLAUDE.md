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
5. `opaq_vault` holds USDC 1:1 and mints a Token-2022 wrapper token (Confidential Transfer extension)
   into the **stealth address's own** wrapper account, which can be shielded. Nothing after the
   payment touches the recipient's wallet (ADR 0001, `docs/adr/`).
6. Cash-out: unshield and withdraw USDC from the stealth account to an address the recipient picks.
7. Viewing keys (scan seed + spend pubkey) find payments and decrypt shielded balances.

## Repository layout (pnpm + Anchor monorepo)

```
programs/            Anchor programs: opaq_registry, opaq_vault (Rust)
apps/web/            Next.js app: payment page, recipient dashboard, Opaq Link
apps/server/         Hono + Postgres: announcement indexer + feed, relayer (fee payer)
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

JS workspaces:

- `pnpm install` – install all workspaces
- `pnpm --filter @opaq/sdk codegen` – regenerate program clients into `packages/sdk/src/generated/`
  from `target/idl` (run after `anchor build` whenever a program's interface changes). Generated code
  is committed; never edit it by hand.
- `pnpm --filter @opaq/sdk test` – vitest; `typecheck`, `build` likewise
- `pnpm test:integration` – `anchor build`, then the Surfpool suite in `tests/`
- `pnpm --filter @opaq/server test` – server suite (Surfpool + a temp Postgres via `initdb`/`pg_ctl`,
  or `DATABASE_URL`); needs `anchor build` first
- `pnpm --filter @opaq/sdk build && pnpm --filter @opaq/server start` – run the server (env: `.env.example`)

## Integration tests (`tests/`)

- Embedded Surfpool (`@solana/surfpool`, offline, dynamic ports): `startTestNet()` in `tests/helpers.ts`
  deploys both programs from `target/deploy`, so run `anchor build` first. The SDK is imported from
  source via a vitest alias (no SDK build needed).
- The network is offline, so tests create their own USDC stand-in (classic SPL mint) and the
  Token-2022 wrapper mint with Confidential Transfer.
- `full-flow.test.ts` covers vault setup → register handle → pay → scan → sweep into the stealth
  account → configure CT + shield → viewing-key decrypt → unshield → cash out 1:1 to a fresh address →
  close, asserts no post-payment transaction mentions the recipient wallet or handle, plus a forged
  sweep. The embedded surfnet has the ZK ElGamal proof program, so CT runs offline.
- Suites run serially (`fileParallelism: false`); each file starts its own surfnet.

## SDK (`packages/sdk`)

- `src/stealth.ts` – stealth address scheme: meta keys, payer derivation, recipient scanning,
  spend scalar, ed25519 signing from a raw scalar. Spec + test vector: `docs/stealth-address-spec.md`.
  Any change to derivation or domain tags needs a version bump, a new vector, and review.
- `src/signer.ts` – `createStealthSigner(scalar)`: Kit `TransactionPartialSigner` for sweeps.
- `src/builders.ts` – instruction builders for the flow; they return instructions only, callers pick
  fee payer and send:
  - `getRegisterHandleInstruction`, `fetchMetaAddress(rpc, name)`
  - `getPayToMetaAddressInstructions` – create stealth ATA (payer pays rent) + `transferChecked` +
    `announce`, in one transaction
  - `decodeAnnouncementEventCpi` (untrusted chain data → `Announcement | null`), `findOwnPayments`
  - `fetchVaultSettings(rpc)` (includes `decimals`), `getSweepToVaultInstructions` – by default
    creates the stealth address's own wrapper ATA (`accountPayer` = relayer) and mints there;
    `deposit` signed by the stealth signer, then close the stealth USDC ATA with rent to
    `rentRecipient`. Passing `destination` (e.g. a wallet-owned account) links the payment to it.
- `src/config.ts` – `OpaqConfig`: `DEVNET_PROGRAMS` / `LOCALNET_PROGRAMS`, `configFromEnv` (see
  `.env.example`) and the chain feature flag `OPAQ_ENABLED_CHAINS` (MVP: `solana` only; `base`/`arbitrum`
  are rejected until CCTP lands). Builders take an optional `programs`; the default is the local build's
  IDs. `fetchVaultSettings` returns `programAddress`, which the sweep/withdraw builders reuse.
- `src/scanner.ts` – `fetchAnnouncements` (pages `getSignaturesForAddress` on the registry's event
  authority), `extractAnnouncements`, `scanForPayments` (scan key only; cursor via `until`/`before`;
  reports USDC still to sweep plus the stealth wrapper account and its public amount),
  `getStealthTokenBalance`. Also `getCreateWrappedTokenAccountInstruction` and
  `getWithdrawFromVaultInstruction` (owner = stealth signer for stealth accounts) in builders.
- `src/keys.ts` – HKDF master-seed → meta keys, wallet-signature derivation, scan-only viewing key
  (`opaqvk1…`), which is also enough to decrypt stealth CT balances.
- `src/confidential.ts` – separate entry `@opaq/sdk/confidential` (pulls in zk-sdk WASM; the main
  entry does not). Per-stealth-account CT keys from the scan seed (spec + vector:
  `docs/stealth-ct-keys.md`), `fetchStealthWrappedBalance`, `getConfigureStealthAccountInstructionPlan`,
  `getShieldInstructions` (deposit + apply in one tx), `getUnshieldInstructionPlan`,
  `getCloseStealthAccountInstructionPlan`. Plans are multi-transaction; send them with Kit's
  transaction planner/executor (see `tests/helpers.ts` `sendPlan`).
- `src/indexer.ts` – `createIndexerClient`, `scanIndexerForPayments` (one cursor, local matching;
  the scalable path). `src/scanner.ts` batches balance lookups (`resolvePayments`, 100 per call).
- `src/relayer.ts` – `createRelayerClient`, `getRelayerSigner` (noop signer for the relayer's
  address, pass as `payer`/`accountPayer`), `sendPlanViaRelayer`.
- `src/admin.ts` – `getInitVaultInstruction` (upgrade authority only), propose/accept/cancel admin.
- `src/disclosure.ts` (in `@opaq/sdk/confidential`) – `createDisclosure` (per-payment keys for a
  time range instead of the scan seed), `verifyDisclosure` (checks entries against chain data).
- `src/generated/{registry,vault}` – Codama clients, exported as `registry` and `vault`.

## Server (`apps/server`)

Hono + Postgres (`pg`, SQL migrations in `src/db.ts`, append-only). ADR 0002.

- `src/indexer.ts` – polls the registry event authority, stores announcements + cursor in one DB
  transaction, idempotent. `src/app.ts` – `GET /v1/announcements`, `GET /v1/relayer`,
  `POST /v1/relay`, `GET /health`.
- `src/relayer.ts` – `checkRelayPolicy` (static allowlist; relayer may only pay fees/rent and receive
  refunds) + simulation cost cap + daily budget + per-client rate limit. Any new client flow that
  goes through the relayer must pass this policy; extend it deliberately, with a negative test.
- The relayer key holds SOL only and must be funded from a treasury unrelated to any user.

## Devnet

- Deployed with `scripts/deploy-devnet.sh` (deploy + immediate `init_config`): vault
  `9hoWkfxQ7igd7LJvmeVt1DjPrctY4wrVR7qgcqNZJn1Q`, registry `DaqD6ZznS3TP1NbC2tPrUiBjMNwPbJR3GseHZsBXABNk`
  (`DEVNET_PROGRAMS` = the committed `declare_id!`s = `LOCALNET_PROGRAMS`). Upgrade authority and
  vault admin: `BUutTYum7f8E2YtpfsUiyDgdbXRUZRWhpVg5mr4iq1g2`. Circle devnet USDC (`4zMMC9…ncDU`),
  50 bps fee, wrapper mint `93MgFRxY1KfY4DUmo7V4dxRZGy2i3nWTtGMGbVyP7PxY` with CT locked. Details and
  the older pre-hardening deployment: `docs/deploy-checklist.md`.
- Tests that need "another deployment" use explicit program IDs, since devnet = localnet IDs.
- The Solana CLI default RPC is often localnet; scripts here pass the RPC explicitly and refuse non-devnet.
- `tests/scripts/init-devnet.ts` – one-time vault setup (dry run unless `--yes`).
- `tests/scripts/smoke-devnet.ts` – register → pay → scan → sweep to the stealth account → shield →
  viewing-key read → unshield → cash out to a fresh address → close → link check (post-payment
  transactions *and* the relayer's own history must not touch the recipient wallet). The relayer is
  funded from the faucet, never the recipient wallet. Needs `OPAQ_SMOKE_DIR` (outside the repo;
  holds `<handle>-seed.json` and resumable state) and a little devnet USDC/SOL. Last passed 2026-10-09 on the
  current deployment (handle `opaq_test`, faucet-funded relayer `7RW3…2ztw`).
- The public devnet RPC returns 429 on proof-heavy plans; the scripts back off and treat
  "already processed" after a retry as success.

## Programs

- `opaq_registry` – `register_handle`, `update_meta_address`, `announce`. Handle PDA:
  `["handle", name]`, names 3–32 chars of `a-z0-9_`. `announce` is stateless and emits the
  `Announcement` event via `emit_cpi!` (indexers read inner instructions, not logs).
- `opaq_vault` – `init_config` (upgrade authority only), `deposit`, `withdraw`, `set_fee`,
  `propose_admin`/`accept_admin`/`cancel_admin_transfer` (PDA `["pending_admin", config]`, so the
  `Config` layout never changed). Config PDA `["config"]` is the vault authority and wrapper mint
  authority; vault PDA `["vault", config]`. The wrapper mint is created client-side (Token-2022 +
  Confidential Transfer with no CT authority, auto-approve and no auditor; no freeze authority;
  config as mint authority). Deployment steps: `docs/deploy-checklist.md`.
  Fee is taken on deposit in the underlying token, capped at `MAX_FEE_BPS = 100`. Invariant:
  vault balance == wrapper supply. Confidential deposit/transfer/withdraw of the wrapper token happen
  client-side against Token-2022, not in this program.
- Token-2022 `InterfaceAccount`s in instruction structs are `Box`ed to stay under the 4 KB BPF stack.

## Non-negotiable rules

- **Never custody user keys.** The spend key never leaves the recipient's device or server. The relayer
  is fee payer only and must not be able to redirect funds. Never fund a relayer from a user's wallet.
- **Not a mixer.** No shared anonymity pool that breaks fund origin. Everything stays traceable to
  viewing-key holders. Do not add features whose purpose is defeating auditability.
- **No new cryptography.** Use audited primitives (ed25519/ECDH, Token-2022 CT, CCTP, Umbra/Arcium).
  Any custom crypto code needs test vectors and review.
- **Fee caps are enforced on-chain** (protocol fee ≤ 1%). Admins cannot move vault funds.
- **Be honest about the privacy level** in UI and docs: payer address and the amount sent to a stealth
  address are public; deposits into `opaq_vault` and cash-out amounts are visible; timing can be
  correlated; CT hides amounts and balances, never who transacts with whom; sending funds from a
  stealth account to the recipient's wallet links them.
- Program code: validate every account (signer, `has_one`, mint), use checked math, emit events for
  every state change.
- Never commit secrets, keypairs, or `.env` files.

## Decisions

- ADR 0001: private balances = Token-2022 CT on stealth-owned wrapper accounts; no consolidation in the MVP.
- ADR 0002: `apps/server` indexer (scalable scanning) and one shared, policy-checked relayer.

## Open decisions

- First EVM chain: Base or Arbitrum.
- Protocol fee: 0.5% or 1%.
- Embedded wallet provider (Privy, Para, or Web3Auth).

Record decisions as short ADRs in `docs/` and update this file.
