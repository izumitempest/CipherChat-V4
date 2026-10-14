#!/bin/sh
# CipherChat "share this deployment" launcher.
#
#   deploy/share.sh            # build + start compose stack + public tunnel
#   deploy/share.sh url        # print the public URL only
#   deploy/share.sh status     # compose services + tunnel state
#   deploy/share.sh down       # stop tunnel and stack (keeps the db volume)
#   deploy/share.sh down wipe  # also removes the database volume (burns all rooms)
#
# What it does:
#   1. Verifies docker, the compose plugin, cloudflared, curl, openssl.
#   2. Creates deploy/.env from .env.example on first run, generating
#      RELAY_INTERNAL_TOKEN (openssl rand -hex 24) and defaulting
#      CADDY_SITE to http://localhost (plain HTTP on :80, because the
#      Cloudflare tunnel terminates TLS at the edge for you).
#   3. docker compose build, then up -d.
#   4. Waits for the app to answer a DB-backed read (the junk-proof
#      healthprobe pattern from Dockerfile.web), the relay to answer an
#      engine.io handshake, and Caddy to serve on :80.
#   5. Starts a cloudflared quick tunnel at http://localhost (port 80),
#      extracts the https://<random>.trycloudflare.com URL from its log,
#      and prints the share link.
#
# IMPORTANT: quick tunnels are disposable. Every restart of this script
# makes a NEW random hostname and the old link dies. For a stable
# hostname, do the one-time named-tunnel setup:
#
#   cloudflared tunnel login
#   cloudflared tunnel create cipherchat
#   # write ~/.cloudflared/config.yml with an ingress rule sending your
#   # hostname to http://localhost:80
#   SHARE_TUNNEL_MODE=named deploy/share.sh
#
# In named mode the script runs `cloudflared tunnel run` instead of a
# quick tunnel, and prints your configured hostname.
#
# The compose stack is self-contained (web + relay + caddy): the single
# tunnel URL serves app and relay because Caddy routes /relay/* to the
# relay and everything else to the web app. Nothing in the app needs to
# know the public hostname.

set -eu

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DEPLOY_DIR"

MODE="${1:-up}"
TUNNEL_MODE="${SHARE_TUNNEL_MODE:-quick}"  # quick | named
TUNNEL_LOG=/tmp/cc-share-tunnel.log
COMPOSE="docker compose"

die() { echo "share.sh: $1" >&2; exit 1; }
note() { echo "share.sh: $1"; }

require() { command -v "$1" >/dev/null 2>&1 || die "missing prerequisite: $1"; }

port_free() {
  if command -v ss >/dev/null 2>&1; then
    ! ss -tln | grep -q ":$1 "
  else
    true
  fi
}

tunnel_url() {
  if [ "$TUNNEL_MODE" = "named" ]; then
    if [ -n "${CF_HOSTNAME:-}" ]; then
      echo "https://$CF_HOSTNAME"
    elif [ -f "$HOME/.cloudflared/config.yml" ]; then
      # first hostname: entry in the ingress config
      awk '/hostname:/ {print $2; exit}' "$HOME/.cloudflared/config.yml" | sed 's/^/https:\/\//'
    fi
  else
    grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$TUNNEL_LOG" 2>/dev/null | tail -1
  fi
}

stop_tunnel() {
  pkill -f "cloudflared tunnel" 2>/dev/null || true
  sleep 1
}

start_tunnel() {
  stop_tunnel
  : > "$TUNNEL_LOG"
  if [ "$TUNNEL_MODE" = "named" ]; then
    [ -n "${CF_TUNNEL_NAME:-}" ] || \
      die "named mode needs CF_TUNNEL_NAME set (cloudflared tunnel login + create first)"
    setsid sh -c "exec cloudflared tunnel run \"$CF_TUNNEL_NAME\"" >> "$TUNNEL_LOG" 2>&1 < /dev/null &
  else
    setsid sh -c 'exec cloudflared tunnel --url http://localhost' >> "$TUNNEL_LOG" 2>&1 < /dev/null &
  fi
  note "tunnel starting (log: $TUNNEL_LOG)"
  for i in $(seq 1 45); do
    url=$(tunnel_url) || true
    [ -n "${url:-}" ] && break
    sleep 2
  done
  url=$(tunnel_url) || true
  [ -n "${url:-}" ] || die "tunnel up but no URL found yet; check $TUNNEL_LOG"
  PUBLIC_URL="$url"
}

wait_http() {
  # wait_http <url> <expected-status> <timeout-seconds> <label>
  exp=$2; limit=$3; label=$4
  i=0
  while [ "$i" -lt "$limit" ]; do
    code=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo 000)
    if [ "$code" = "$exp" ]; then
      note "$label answering ($exp)"
      return 0
    fi
    i=$((i + 3))
    sleep 3
  done
  die "$label did not answer with $exp within ${limit}s"
}

case "$MODE" in
  url)
    url=$(tunnel_url) || true
    if [ -n "${url:-}" ]; then echo "$url"; else die "no live tunnel found (start with: deploy/share.sh)"; fi
    exit 0
    ;;

  status)
    $COMPOSE ps
    url=$(tunnel_url) || true
    if [ -n "${url:-}" ]; then echo "public URL: $url"; else echo "public URL: none"; fi
    exit 0
    ;;

  down)
    stop_tunnel
    if [ "${2:-}" = "wipe" ]; then
      note "stopping stack AND removing the database volume (all rooms burn)"
      $COMPOSE down -v
    else
      note "stopping stack (database kept)"
      $COMPOSE down
    fi
    exit 0
    ;;

  up)
    ;;
  *)
    die "usage: deploy/share.sh [up|down|down wipe|url|status]"
    ;;
esac

# --- up ---------------------------------------------------------------------

require docker
require curl
require cloudflared
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"
command -v openssl >/dev/null 2>&1 || note "openssl missing; will try python3 for token generation"

port_free 80  || die "port 80 is already in use; stop the other web server first (Caddy needs :80)"
port_free 443 || die "port 443 is already in use; the compose file publishes it even when the tunnel only needs :80"

if [ ! -f .env ]; then
  [ -f .env.example ] || die ".env.example missing next to this script"
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    token=$(openssl rand -hex 24)
  elif command -v python3 >/dev/null 2>&1; then
    token=$(python3 -c "import secrets; print(secrets.token_hex(24))")
  else
    die "cannot generate RELAY_INTERNAL_TOKEN (need openssl or python3)"
  fi
  sed -i "s#^RELAY_INTERNAL_TOKEN=.*#RELAY_INTERNAL_TOKEN=$token#" .env
  # Plain HTTP on :80 behind the tunnel: Cloudflare's edge owns TLS.
  if grep -q "^# CADDY_SITE" .env; then
    sed -i "s#^# CADDY_SITE.*#CADDY_SITE=http://localhost#" .env || true
  fi
  if grep -q "^CADDY_SITE=" .env; then
    sed -i "s#^CADDY_SITE=.*#CADDY_SITE=http://localhost#" .env
  else
    printf "CADDY_SITE=http://localhost\n" >> .env
  fi
  note ".env created with a fresh RELAY_INTERNAL_TOKEN"
fi

note "building images (first run pulls base images; it is the slow one)"
if ! $COMPOSE build; then
  die "compose build failed; output above is the error"
fi

note "starting stack"
$COMPOSE up -d

note "waiting for the web tier (database-backed check)"
wait_http "http://localhost:80/api/rooms/healthprobe0" 404 240 "web+caddy"

note "waiting for the relay through the same port (Caddy /relay/ strip)"
i=0
while [ "$i" -lt 120 ]; do
  body=$(curl -sS -m 5 "http://localhost:80/relay/?EIO=4&transport=polling" 2>/dev/null || true)
  case "$body" in
    0\{*) break ;;
  esac
  i=$((i + 3))
  sleep 3
done
case "${body:-}" in
  0\{*) note "relay answering engine.io handshake through Caddy" ;;
  *) die "relay did not answer through Caddy /relay/ in time";;
esac

start_tunnel

PUBLIC_URL=$(tunnel_url)

echo
note "share link ready"
echo "    $PUBLIC_URL"
echo
echo "open it, create a room, share the link and password on separate"
echo "channels. The room registry lives in the compose database volume."
echo
echo "reminder: this hostname is random and dies when the tunnel stops."
echo "for a stable name: cloudflared tunnel login, then run this script"
echo "with SHARE_TUNNEL_MODE=named (README and TOR.md cover the story)."
