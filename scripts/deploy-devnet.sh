#!/usr/bin/env bash
# Deploys opaq_registry and opaq_vault to devnet with YOUR wallet as upgrade authority, then
# immediately initialises the vault. Only the upgrade authority can call init_config, so nobody
# can initialise the new deployment in between.
#
#   scripts/deploy-devnet.sh            # checks and prints the plan, sends nothing
#   scripts/deploy-devnet.sh --yes      # deploys (or skips already-deployed programs) and inits
#
# Options: --no-build (use the existing target/deploy artefacts)
# Env:     OPAQ_KEYPAIR      wallet = fee payer + upgrade authority + vault admin
#                            (default ~/.config/solana/id.json)
#          OPAQ_RPC_URL      default https://api.devnet.solana.com
#          OPAQ_USDC_MINT, OPAQ_FEE_BPS, OPAQ_TREASURY_OWNER   passed to init-devnet.ts
#
# Program IDs are the keypairs in target/deploy, which must match declare_id! in the source.
# Keep those keypair files: they are gitignored and identify this deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${OPAQ_RPC_URL:-https://api.devnet.solana.com}"
KEYPAIR="${OPAQ_KEYPAIR:-$HOME/.config/solana/id.json}"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
YES=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --no-build) BUILD=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
sol() { awk -v l="$1" 'BEGIN { printf "%.4f", l / 1e9 }'; }

# --- 1. checks ----------------------------------------------------------------------------
genesis="$(solana genesis-hash --url "$URL")"
[ "$genesis" = "$DEVNET_GENESIS" ] || die "$URL is not devnet (genesis $genesis). Refusing."
[ -f "$KEYPAIR" ] || die "wallet keypair not found: $KEYPAIR"
WALLET="$(solana address -k "$KEYPAIR")"

cd "$ROOT"
if [ "$BUILD" = 1 ]; then
  say "building programs (NO_DNA=1 anchor build)…"
  NO_DNA=1 anchor build >/dev/null 2>&1 || die "anchor build failed; run 'NO_DNA=1 anchor build' to see why"
fi

declare_id() { sed -n 's/^declare_id!("\(.*\)");/\1/p' "programs/$1/src/lib.rs"; }
# Largest first: the upload buffer (same size as the program, refunded right after) is what
# makes the peak, so deploying the vault before the registry needs the least SOL at once.
PROGRAMS=(opaq_vault opaq_registry)
DEPLOYED=0
PEAK=0
PLAN=()
for program in "${PROGRAMS[@]}"; do
  so="target/deploy/$program.so"
  kp="target/deploy/$program-keypair.json"
  [ -f "$so" ] && [ -f "$kp" ] || die "$so or $kp missing; run without --no-build"
  id="$(solana address -k "$kp")"
  [ "$id" = "$(declare_id "$program")" ] || die "$kp ($id) does not match declare_id! in programs/$program; run 'NO_DNA=1 anchor keys sync' and rebuild"

  if solana account "$id" --url "$URL" >/dev/null 2>&1; then
    authority="$(solana program show "$id" --url "$URL" | sed -n 's/^Authority: //p')"
    [ "$authority" = "$WALLET" ] || die "$program $id already exists with upgrade authority $authority, not $WALLET"
    PLAN+=("$program $id: already deployed by you, skip")
  else
    size=$(( $(stat -f%z "$so" 2>/dev/null || stat -c%s "$so") + 45 ))
    rent="$(solana rent "$size" --url "$URL" --lamports | sed -n 's/^Rent-exempt minimum: \([0-9]*\) lamports$/\1/p')"
    step=$(( DEPLOYED + 2 * rent ))
    PEAK=$(( step > PEAK ? step : PEAK ))
    DEPLOYED=$(( DEPLOYED + rent ))
    PLAN+=("$program $id: deploy, program data $(sol "$rent") SOL (kept as rent)")
  fi
done
NEED=$(( PEAK + 200000000 )) # + 0.2 SOL for fees, the wrapper mint and init
BALANCE="$(solana balance "$WALLET" --url "$URL" --lamports | awk 'NF {print $1}')"

say ""
say "wallet (fee payer, upgrade authority, vault admin): $WALLET"
say "balance: $(sol "$BALANCE") SOL, needed at peak: $(sol "$NEED") SOL"
for line in "${PLAN[@]}"; do say "  $line"; done
say "then: init_config on the new vault (see tests/scripts/init-devnet.ts for mint, fee, treasury)"

if [ "$BALANCE" -lt "$NEED" ]; then
  die "not enough SOL: short by $(sol $(( NEED - BALANCE ))) SOL. Top up $WALLET (https://faucet.solana.com) and rerun."
fi
if [ "$YES" != 1 ]; then
  say ""
  say "Dry run. Rerun with --yes to deploy and initialise."
  exit 0
fi

# --- 2. deploy ----------------------------------------------------------------------------
trap 'say ""; say "Deploy interrupted. Recover SOL left in upload buffers with:"; say "  solana program close --buffers --keypair $KEYPAIR --url $URL"' ERR
for program in "${PROGRAMS[@]}"; do
  id="$(solana address -k "target/deploy/$program-keypair.json")"
  if solana account "$id" --url "$URL" >/dev/null 2>&1; then continue; fi
  say "deploying $program → $id"
  solana program deploy "target/deploy/$program.so" \
    --program-id "target/deploy/$program-keypair.json" \
    --upgrade-authority "$KEYPAIR" \
    --keypair "$KEYPAIR" \
    --url "$URL" \
    --with-compute-unit-price 1000
done
trap - ERR

REGISTRY_ID="$(solana address -k target/deploy/opaq_registry-keypair.json)"
VAULT_ID="$(solana address -k target/deploy/opaq_vault-keypair.json)"

# --- 3. init ------------------------------------------------------------------------------
say ""
say "initialising the vault"
pnpm --filter @opaq/sdk build >/dev/null
(
  cd tests
  OPAQ_RPC_URL="$URL" OPAQ_KEYPAIR="$KEYPAIR" \
    OPAQ_REGISTRY_PROGRAM_ID="$REGISTRY_ID" OPAQ_VAULT_PROGRAM_ID="$VAULT_ID" \
    npx tsx scripts/init-devnet.ts --yes
)

say ""
say "Done. Point the SDK, server and scripts at this deployment:"
say "  OPAQ_CLUSTER=devnet"
say "  OPAQ_REGISTRY_PROGRAM_ID=$REGISTRY_ID"
say "  OPAQ_VAULT_PROGRAM_ID=$VAULT_ID"
say "Back up target/deploy/*-keypair.json (gitignored). Before mainnet, move the upgrade"
say "authority to a multisig (docs/deploy-checklist.md)."
