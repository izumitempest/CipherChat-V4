# CipherChat over Tor

This adds an optional onion (hidden service) entry point to the
production stack. The public Caddy listener running TLS on 80/443 is
unchanged; the onion merely adds a second way in.

## What this adds, and what it does not

- **What it adds**: the user's IP address is hidden from the relay's
  operator and from the hosting network. The network sees a Tor circuit,
  not a user at an address visiting your server. This addresses the
  relay's "metadata" residual in Section 10 of `public/legal/privacy.md`
  (the relay sees who connects and when): with the onion gateway in use,
  the "who" at the network layer is Tor, not the user.
- **What it does not change**: content secrecy. Messages were already
  encrypted end-to-end between browsers; the onion adds transport
  privacy, not content security. The relay also still sees connection
  timing inside its own process if someone runs it: Tor does not hide
  that a known .onion belongs to a room, only who is behind a circuit.

## Verification step that could not run in the sandbox

The `tor` image's interface is declared from its published docs, not
verified by pulling the image here. Before first deploy, inspect the
merged compose the stack will actually run:

```bash
cd deploy
docker compose -f docker-compose.yml -f docker-compose.onion.yml config
```

Confirm the `tor` service has `image: osminogin/tor-simple:latest`,
its two mounts (`./tor/torrc` read-only and the `tor-keys` named
volume at `/var/lib/tor`), and that the `caddy` service's `command`
now points at `/etc/caddy/Caddyfile.onion`. If the named image ever
changes its CLI (it currently runs `tor` with a config at
`/etc/tor/torrc`), use any minimal Tor image instead: the only contract
is "runs the tor binary against this torrc on a volume at /var/lib/tor".

## Bring-up

```bash
cd deploy
# .env must exist per the base stack (README.md "Production")
docker compose -f docker-compose.yml -f docker-compose.onion.yml up -d
docker compose logs -f tor
```

The onion address arrives once tor finishes bootstrapping:

```bash
docker compose exec tor cat /var/lib/tor/cipherchat/hostname
```

(The service name inside the `torkeys` volume directory is always
`/var/lib/tor/cipherchat/hostname`. If you changed the image and the
exec name fails, read the named volume directly.)

Example address: `http://abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234.onion`

## Using it

Open the .onion address in a Tor-capable browser (Tor Browser, Brave in
private-with-Tor mode, etc.). Nothing else changes:

- Room links are `https://<site>/<room-code>` on clearnet and
  `http://<onion-hostname>/<room-code>` over Tor; the room code is what
  joins people, never the origin.
- `NEXT_PUBLIC_RELAY_URL` stays at its `/relay/` default: the
  `Caddyfile.onion` gateway strips that prefix and forwards to the
  relay on the same internal network it already shares with the app.

## The address is a cryptographic identity

The onion address is a public key. The private half lives on the
`tor-keys` volume at `/var/lib/tor/cipherchat/`. If you lose that volume
(`docker compose down -v` removes it), the next boot generates a new
address and there is no recovery. Back the volume up if the address
appears anywhere public.

## Stopping

```bash
cd deploy
docker compose -f docker-compose.yml -f docker-compose.onion.yml down
```

To also burn the onion identity (and produce a new address on next
launch): `docker compose ... down -v`. Burn your rooms first; the
server does not distinguish a permanent teardown from a restart.
