#!/bin/sh
# CipherChat dev launcher: runs both required services from one command.
#
#   scripts/dev.sh           # web (:3000) + relay (:3003, presence :3004)
#   scripts/dev.sh web       # only the Next.js app
#   scripts/dev.sh relay     # only the relay
#   scripts/dev.sh check     # prerequisites only, no startup
#
# Prereqs (checked up front):
#   - bun on PATH
#   - .env exists (DATABASE_URL, RELAY_INTERNAL_TOKEN, NEXT_PUBLIC_RELAY_URL)
#   - mini-services/relay-service/node_modules installed (bun install)
#   - prisma client generated (bun run db:generate)
#
# The relay's own "dev" script uses bun --hot, which the README warns does
# not reliably reload socket handlers; this launcher runs it plainly and
# simply keeps both processes alive together. Ctrl-C stops both.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

MODE="${1:-all}"

die() { echo "dev.sh: $1" >&2; exit 1; }

command -v bun >/dev/null 2>&1 || die "bun not found on PATH"
[ -f .env ] || die ".env missing (cp .env.example .env, then set RELAY_INTERNAL_TOKEN)"

# RELAY_INTERNAL_TOKEN must be set and must not still be the example value.
token=$(awk -F= '/^RELAY_INTERNAL_TOKEN=/ {print $2}' .env | tail -1)
[ -n "$token" ] || die "RELAY_INTERNAL_TOKEN is empty in .env"
[ "$token" != "change-me-openssl-rand-hex-24" ] || \
  die "RELAY_INTERNAL_TOKEN is still the placeholder; run: openssl rand -hex 24"

[ -d mini-services/relay-service/node_modules ] || \
  die "relay deps missing; run: cd mini-services/relay-service && bun install"

[ -d node_modules/.prisma/client ] || \
  die "prisma client not generated; run: bun run db:generate"

if [ "$MODE" = "check" ]; then
  echo "dev.sh: prerequisites ok"
  exit 0
fi

# DATABASE_URL is file:./db/custom.db (resolved relative to the repo's
# working directory by Next.js standalone at runtime). Make sure the
# target directory always exists; a missing one means a 500 on first write.
mkdir -p db

WEB_PID=""
RELAY_PID=""
WEB_LOG=dev.log
RELAY_LOG=relay-dev.log

cleanup() {
  trap '' INT TERM
  [ -n "$RELAY_PID" ] && kill "$RELAY_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "dev.sh: stopped"
  exit 0
}
trap cleanup INT TERM

start_web() {
  echo "dev.sh: web on :3000 (log: $WEB_LOG)"
  bun run dev >>"$WEB_LOG" 2>&1 &
  WEB_PID=$!
}

start_relay() {
  echo "dev.sh: relay on :3003, internal presence :3004 (log: $RELAY_LOG)"
  (cd mini-services/relay-service && bun --env-file=../../.env index.ts) >>"$RELAY_LOG" 2>&1 &
  RELAY_PID=$!
}

case "$MODE" in
  all)   start_relay; start_web ;;
  web)   start_web ;;
  relay) start_relay ;;
  *)     die "usage: scripts/dev.sh [all|web|relay|check]" ;;
esac

# Portable watchdog: if a child exits, report and stop the other.
while :; do
  if [ -n "$WEB_PID" ] && ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "dev.sh: web (pid $WEB_PID) exited; tail of $WEB_LOG:" >&2
    tail -n 5 "$WEB_LOG" >&2 || true
    cleanup
  fi
  if [ -n "$RELAY_PID" ] && ! kill -0 "$RELAY_PID" 2>/dev/null; then
    echo "dev.sh: relay (pid $RELAY_PID) exited; tail of $RELAY_LOG:" >&2
    tail -n 5 "$RELAY_LOG" >&2 || true
    cleanup
  fi
  sleep 2
done
