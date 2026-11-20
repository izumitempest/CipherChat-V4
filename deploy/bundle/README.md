# CipherChat — Deploy in 5 Minutes

CipherChat is a private, end-to-end-encrypted chat that runs on your own
server. No accounts, no message history, nothing stored. You create a room,
share the link and password, and talk. When you're done, you burn the room.

## What you need

- A computer or VPS running Linux with **Docker** and **Docker Compose**
  installed
- About 10 minutes of your time

That's it. No coding, no command-line wizardry.

## Step 1: Get the files

Download the CipherChat deploy bundle from this release page and unzip it:

```bash
unzip cipherchat-deploy-v1.0.0-rc.2.zip
cd cipherchat-deploy-v1.0.0-rc.2
```

## Step 2: Configure

Open the `.env` file in a text editor and fill in two values:

```
# Generate this: openssl rand -hex 24
RELAY_INTERNAL_TOKEN=your-secret-token-here

# Your domain name (e.g., chat.example.com)
CADDY_SITE=your-domain.com
```

- **RELAY_INTERNAL_TOKEN**: A secret password between the web app and the
  relay. Generate one by running `openssl rand -hex 24` in your terminal.
- **CADDY_SITE**: Your domain name. Caddy will automatically get a free
  SSL certificate (HTTPS) for it.

Save the file and close it.

## Step 3: Start

Run this command:

```bash
docker compose up -d
```

Docker will download the CipherChat images, start the web server, relay, and
Caddy, and set up the database. This takes a minute the first time.

When it's done, your CipherChat instance is live at `https://your-domain.com`.

## Step 4: Use it

Open `https://your-domain.com` in your browser. Create a room, share the link
and password through different channels (e.g., link by email, password by
text message), and start chatting.

## Step 5: Stop (when you're done)

```bash
docker compose down
```

This stops the server but keeps your database. To remove everything
including the database:

```bash
docker compose down -v
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `docker: command not found` | Install Docker from https://docker.com |
| `docker compose: command not found` | Install Docker Compose plugin |
| Site won't load | Make sure ports 80 and 443 are open on your server firewall |
| SSL certificate error | Make sure your domain points to this server's IP address |
| Can't create a room | Check `.env` has `RELAY_INTERNAL_TOKEN` set |

## Security notes

- CipherChat encrypts everything in your browser. The server cannot read
  messages.
- The `RELAY_INTERNAL_TOKEN` is a secret — don't share it.
- Burn rooms when you're done with them. There is no undo.
- No message history is stored anywhere on the server.

## Upgrading

To upgrade to a new version:

```bash
docker compose down
docker compose pull
docker compose up -d
```

Your rooms and database are preserved.

## Help

Having trouble? Email **lilice308@gmail.com** or file an issue on GitHub.
