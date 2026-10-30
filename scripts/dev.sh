#!/bin/sh
# CipherChat dev launcher (the old one).
#
# There are two launchers in this repository and there used to be two
# ways to start the stack, which is one too many. start-dev.sh at the
# repository root is the supported path: it fills in a missing .env,
# applies the migrations, stops stale instances, starts the relay and
# the web app detached, waits for all three ports, and can put a pair
# of https tunnels in front for phone testing.
#
# This file stays so the old command still works. It forwards to
# start-dev.sh and does nothing of its own.
#
#   scripts/dev.sh          → start-dev.sh up
#   scripts/dev.sh web      → start-dev.sh up   (web only is not supported
#                                              by start-dev.sh; use
#                                              bun run dev for the app alone)
#   scripts/dev.sh relay    → bun mini-services/relay-service/index.ts
#   scripts/dev.sh check    → start-dev.sh status
#
# See bugs/BUGS.md B42.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MODE="${1:-up}"

case "$MODE" in
  up)
    exec "$ROOT/start-dev.sh" up
    ;;
  web)
    echo "dev.sh: the web app alone"
    exec bun run dev
    ;;
  relay)
    echo "dev.sh: the relay alone"
    exec bun "$ROOT/mini-services/relay-service/index.ts"
    ;;
  check|status)
    exec "$ROOT/start-dev.sh" status
    ;;
  stop)
    exec "$ROOT/start-dev.sh" stop
    ;;
  restart)
    exec "$ROOT/start-dev.sh" restart
    ;;
  *)
    echo "usage: scripts/dev.sh [up|web|relay|check|status|stop|restart]" >&2
    exit 1
    ;;
esac
