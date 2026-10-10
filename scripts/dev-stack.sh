#!/usr/bin/env bash
# Runs the whole local development stack with one command and stops it all on Ctrl+C:
#   - a local chain with both programs and the vault set up   http://localhost:8899
#   - the Opaq server (relayer + indexer) on a temp Postgres   http://localhost:8788
#   - the web app                                              http://localhost:3000
#
#   pnpm dev:stack                          # start everything
#   pnpm dev:stack <wallet> [<wallet>...]   # also fund wallets with SOL and USDC once the chain is up
#
# Env: WEB_PORT (3000), CHAIN_PORT (8899), SERVER_PORT (8788), SKIP_BUILD=1 (do not run
#      `anchor build` when the program binaries are missing).
# Nothing is written to apps/web/.env.local: the web app gets its settings from this script, so
# your own .env.local (for example one pointing at devnet) is left alone while this runs.
# The chain is in memory: handles and payments are gone when it stops.
set -euo pipefail

cd "$(dirname "$0")/.."

WEB_PORT="${WEB_PORT:-3000}"
CHAIN_PORT="${CHAIN_PORT:-8899}"
SERVER_PORT="${SERVER_PORT:-8788}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# lsof exits 1 when nothing listens, which would trip `set -e`; a free port is the normal case.
port_holder() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}' || true; }

for entry in "web:$WEB_PORT" "chain:$CHAIN_PORT" "opaq server:$SERVER_PORT"; do
  name="${entry%%:*}"; port="${entry##*:}"
  holder="$(port_holder "$port")"
  [ -z "$holder" ] || fail "Port $port ($name) is already in use by $holder. Stop it, or set WEB_PORT / CHAIN_PORT / SERVER_PORT."
done

command -v pnpm >/dev/null || fail "pnpm is not installed."
[ -d node_modules ] || { say "Installing dependencies"; pnpm install; }

if [ ! -f target/deploy/opaq_registry.so ] || [ ! -f target/deploy/opaq_vault.so ]; then
  [ "${SKIP_BUILD:-}" = 1 ] && fail "target/deploy has no program binaries. Run: NO_DNA=1 anchor build"
  command -v anchor >/dev/null || fail "target/deploy has no program binaries and anchor is not installed."
  say "Building the programs (first run only)"
  NO_DNA=1 anchor build
fi

CHAIN_URL="http://localhost:$CHAIN_PORT"
SERVER_URL="http://localhost:$SERVER_PORT"
LOG_DIR="${TMPDIR:-/tmp}/opaq-dev-stack"
mkdir -p "$LOG_DIR"

# Job control gives each background job its own process group, so one signal stops the whole tree
# (pnpm, tsx, the server and its Postgres) and the chain can clean up after itself.
set -m
CHAIN_PID=""
WEB_PID=""
stop_group() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || return 0; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  echo
  say "Stopping the local stack"
  stop_group "$WEB_PID"
  stop_group "$CHAIN_PID"
}
trap cleanup EXIT INT TERM

say "Building the SDK (the web app and the server import its build)"
pnpm --filter @opaq/sdk build >/dev/null

say "Starting the local chain and the Opaq server (logs: $LOG_DIR/chain.log)"
DEV_NET_PORT="$CHAIN_PORT" DEV_SERVER_PORT="$SERVER_PORT" \
  pnpm --filter @opaq/integration-tests dev-net >"$LOG_DIR/chain.log" 2>&1 &
CHAIN_PID=$!

for _ in $(seq 1 120); do
  kill -0 "$CHAIN_PID" 2>/dev/null || { tail -20 "$LOG_DIR/chain.log" >&2; fail "The local chain stopped. See $LOG_DIR/chain.log"; }
  if curl -fs "$CHAIN_URL/info" >/dev/null 2>&1 && curl -fs "$SERVER_URL/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
[ "${READY:-}" = 1 ] || { tail -20 "$LOG_DIR/chain.log" >&2; fail "The local stack did not come up in 2 minutes. See $LOG_DIR/chain.log"; }

say "Local stack is up"
curl -s "$CHAIN_URL/info" | sed 's/[{}"]//g; s/,/\n  /g; s/^/  /' | grep -E "usdcMint|wrappedMint" || true
echo "  relayer + indexer  $SERVER_URL"

for wallet in "$@"; do
  if curl -fs -X POST "$CHAIN_URL/faucet" -d "{\"address\":\"$wallet\"}" >/dev/null; then
    echo "  funded $wallet with SOL and USDC"
  else
    echo "  could not fund $wallet (is it a valid Solana address?)" >&2
  fi
done
echo "  fund a wallet later: curl -X POST $CHAIN_URL/faucet -d '{\"address\":\"<address>\"}'"
echo

say "Starting the web app on http://localhost:$WEB_PORT (Ctrl+C stops everything)"
# Values set here win over apps/web/.env.local.
export NEXT_PUBLIC_OPAQ_CLUSTER=localnet
export NEXT_PUBLIC_RPC_URL="$CHAIN_URL"
export NEXT_PUBLIC_OPAQ_SERVER_URL="$SERVER_URL"
export PORT="$WEB_PORT"
# A background job (own process group) that the script waits on, so Ctrl+C reaches the trap at once
# instead of after the web app exits, and the whole tree is stopped together.
pnpm --filter @opaq/web exec next dev --port "$WEB_PORT" &
WEB_PID=$!
wait "$WEB_PID" || true
