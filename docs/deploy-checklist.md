# Deployment checklist (programs)

For whoever holds the program upgrade authority. Applies to devnet now and mainnet later.

## What changed in the programs

- `opaq_vault::init_config` now requires the signer to be the program's **upgrade authority**
  (extra accounts `program`, `program_data`), and the wrapper mint's Confidential Transfer
  settings must be locked: no CT authority, `auto_approve_new_accounts = true`, no auditor key.
- New instructions `propose_admin`, `accept_admin`, `cancel_admin_transfer` (two-step admin
  change, separate PDA `["pending_admin", config]`). The `Config` layout is unchanged.

## Devnet

Current deployment (2026-10-09, `scripts/deploy-devnet.sh`). The SDK's `DEVNET_PROGRAMS` and
`Anchor.toml` `[programs.devnet]` point here.

| Account | Address |
|---|---|
| `opaq_vault` program | `9hoWkfxQ7igd7LJvmeVt1DjPrctY4wrVR7qgcqNZJn1Q` |
| `opaq_registry` program | `DaqD6ZznS3TP1NbC2tPrUiBjMNwPbJR3GseHZsBXABNk` |
| Upgrade authority (both) and vault admin | `BUutTYum7f8E2YtpfsUiyDgdbXRUZRWhpVg5mr4iq1g2` |
| Vault config PDA `["config"]` | `GMYMnieArfKUTdTFpi481pTw2xDKW4ieoRSgYq9rRQaS` |
| Vault token account PDA `["vault", config]` | `F3GP1m4bjciCL1zuHPgpxWQAgjKqYDvoKZSrvRFv4rjR` |
| Wrapper mint (Token-2022, CT locked) | `93MgFRxY1KfY4DUmo7V4dxRZGy2i3nWTtGMGbVyP7PxY` |
| Underlying mint (Circle devnet USDC) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Treasury (admin's USDC account) | `5d5y5TKvzsA5MFWejsArZduKp8vNf1PHQkCd4iMYYL2S` |
| Fee | 50 bps |
| Smoke-test relayer (faucet-funded, unlinked) | `7RW3RSdyu7EYqyJzWj3j8egdgmP7MZL5gEnTrjdY2ztw` |

Program IDs equal the committed `declare_id!`s; the program keypairs in `target/deploy` are
gitignored and must be kept by the deployer.

- Upgrade: `NO_DNA=1 anchor build`, then `solana program deploy target/deploy/<program>.so
  --program-id target/deploy/<program>-keypair.json --upgrade-authority <wallet> --url devnet`.
  Keep `target/deploy/*-keypair.json` backed up; they are gitignored.
- Fresh deployment elsewhere: `scripts/deploy-devnet.sh` (dry run first, then `--yes`) deploys
  both programs and runs `init_config` straight away.
- Verify: `solana program show <id> --url devnet`, then `tests/scripts/smoke-devnet.ts`.

The first devnet deployment runs the pre-hardening programs and is no longer the SDK default;
reach it with `OPAQ_*_PROGRAM_ID` if needed:

| Account | Address |
|---|---|
| `opaq_vault` program | `JHC14FJWJWAkLNj4aDe1EPr65ideg4tSoZmrdXuZtPA` |
| `opaq_registry` program | `6xaXX6KSFxkNohbanstr2Sqpk3teRUExuLQ1u1ndcEyE` |
| Upgrade authority (both) | `BThVK3fZZf8rEoGUHrpzBq1DimVYy8ASj8ZXMQhCN9VW` |
| Vault config PDA (admin `BUutTY…iq1g2`) | `EP628XDTgJmopN6ijdNaEAeqpxcR67MyTvYhrpFqEoyf` |
| Wrapper mint (CT authority = admin, not locked) | `3u7BHHNES1wdwTSGGXQiVnTATTeRMXKeDTtePaE2duFX` |

## Mainnet (before any user funds)

1. Deploy with a fresh key; immediately run `init_config` with the same key (only it can).
2. Move the upgrade authority to a multisig with a timelock (e.g. Squads):
   `solana program set-upgrade-authority <id> --new-upgrade-authority <multisig>`. A single
   key that can upgrade `opaq_vault` can drain the vault.
3. Transfer vault admin to a multisig: `propose_admin` → `accept_admin` from the multisig.
4. Treasury: a dedicated USDC account, not any user's or the admin's working account.
5. Consider making the registry immutable once stable (`--final`), since it holds no funds.
6. Get the stealth scheme, `signWithScalar`, and `docs/stealth-ct-keys.md` reviewed externally.
