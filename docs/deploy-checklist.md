# Deployment checklist (programs)

For whoever holds the program upgrade authority. Applies to devnet now and mainnet later.

## What changed in the programs

- `opaq_vault::init_config` now requires the signer to be the program's **upgrade authority**
  (extra accounts `program`, `program_data`), and the wrapper mint's Confidential Transfer
  settings must be locked: no CT authority, `auto_approve_new_accounts = true`, no auditor key.
- New instructions `propose_admin`, `accept_admin`, `cancel_admin_transfer` (two-step admin
  change, separate PDA `["pending_admin", config]`). The `Config` layout is unchanged.

## Devnet

Current deployment (2026-10-09, `scripts/deploy-devnet.sh`): vault `9hoW…Jn1Q`, registry
`DaqD…XABNk` (= the committed `declare_id!`s), upgrade authority and vault admin `BUutTY…iq1g2`,
config `GMYM…RQaS`, wrapper mint `93Mg…7PxY` (CT locked), treasury `5d5y…YL2S` (admin's USDC
account). The SDK's `DEVNET_PROGRAMS` points here.

- Upgrade: `NO_DNA=1 anchor build`, then `solana program deploy target/deploy/<program>.so
  --program-id target/deploy/<program>-keypair.json --upgrade-authority <wallet> --url devnet`.
  Keep `target/deploy/*-keypair.json` backed up; they are gitignored.
- Fresh deployment elsewhere: `scripts/deploy-devnet.sh` (dry run first, then `--yes`) deploys
  both programs and runs `init_config` straight away.
- Verify: `solana program show <id> --url devnet`, then `tests/scripts/smoke-devnet.ts`.

The first devnet deployment (vault `JHC14…tPA`, registry `6xaX…cyE`, upgrade authority
`BThV…N9VW`) runs the pre-hardening programs and is no longer the SDK default; reach it with
`OPAQ_*_PROGRAM_ID` if needed.

## Mainnet (before any user funds)

1. Deploy with a fresh key; immediately run `init_config` with the same key (only it can).
2. Move the upgrade authority to a multisig with a timelock (e.g. Squads):
   `solana program set-upgrade-authority <id> --new-upgrade-authority <multisig>`. A single
   key that can upgrade `opaq_vault` can drain the vault.
3. Transfer vault admin to a multisig: `propose_admin` → `accept_admin` from the multisig.
4. Treasury: a dedicated USDC account, not any user's or the admin's working account.
5. Consider making the registry immutable once stable (`--final`), since it holds no funds.
6. Get the stealth scheme, `signWithScalar`, and `docs/stealth-ct-keys.md` reviewed externally.
