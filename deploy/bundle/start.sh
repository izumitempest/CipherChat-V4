#!/bin/sh
# CipherChat one-command startup.
#
#   ./start.sh        # configure .env if needed, then start
#   ./start.sh stop   # stop the server
#   ./start.sh status # check if services are running

set -eu

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DEPLOY_DIR"

say()  { printf '\033[1;32m[cipherchat]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[cipherchat]\033[0m %s\n' "$*" >&2; exit 1; }

# --- configure .env if needed ---
if [ ! -f .env ]; then
  say "Creating .env from .env.example..."
  cp .env.example .env
  say "Please edit .env and set RELAY_INTERNAL_TOKEN and CADDY_SITE, then run ./start.sh again."
  exit 0
fi

# --- check required env vars ---
set -a; . ./.env; set +a

if [ -z "${RELAY_INTERNAL_TOKEN:-}" ] || [ "$RELAY_INTERNAL_TOKEN" = "change-me-openssl-rand-hex-24" ]; then
  die "RELAY_INTERNAL_TOKEN not set in .env. Generate one: openssl rand -hex 24"
fi

if [ -z "${CADDY_SITE:-}" ] || [ "$CADDY_SITE" = "localhost" ]; then
  say "WARNING: CADDY_SITE is set to localhost. HTTPS certificate will use an internal CA (browser warning)."
  say "For a real domain, set CADDY_SITE=your-domain.com in .env"
fi

# --- start ---
case "${1:-}" in
  stop)
    say "Stopping CipherChat..."
    docker compose down
    say "Stopped."
    ;;
  status)
    docker compose ps
    ;;
  *)
    say "Starting CipherChat..."
    docker compose up -d
    say "CipherChat is starting. Open https://${CADDY_SITE:-localhost} in your browser."
    say "Run './start.sh status' to check if services are healthy."
    ;;
esac
