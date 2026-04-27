# Historical Self-Hosted Convex Setup

This document is historical and does not describe the active production stack.

The live production stack uses `apps/api` + `apps/worker` + Postgres + Redis and is documented in
[`deploy/README.md`](../README.md).

---

# Self-Hosted Debian VPS Setup

This deploy bundle is designed for the current app shape:

- TanStack Start web app served by Nitro
- self-hosted Convex backend and dashboard
- Caddy for HTTPS and reverse proxy
- Docker Compose for portability

It is intentionally minimal:

- only `80` and `443` are public
- Convex dashboard binds to `127.0.0.1:6791` only
- Minecraft stays untouched on its existing port, typically `25565`

## Domains

Create DNS records that point to the VPS:

- `APP_DOMAIN`, e.g. `app.example.com`
- `CONVEX_API_DOMAIN`, e.g. `api.example.com`
- `CONVEX_SITE_DOMAIN`, e.g. `site.example.com`

The web app must live on `APP_DOMAIN`.

The Convex API and Convex HTTP actions must each have their own public origin because the app already treats them as separate URLs.

## Server bootstrap

Install Docker Engine and the Compose plugin using Docker's official Debian instructions:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

You do not need to install Caddy separately on the host. The Compose stack runs Caddy in Docker.

Before changing anything, inspect existing listeners so you do not break Minecraft:

```bash
sudo ss -tulpn
```

If Minecraft is already running in Docker, also inspect current published ports:

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

If something is already using port `80` or `443`, stop that service first. Common candidates are `nginx`, `apache2`, or an old `caddy` service:

```bash
sudo systemctl status nginx apache2 caddy
```

Expected outcome for this stack:

- port `80/tcp` free
- port `443/tcp` free
- Minecraft port unchanged, often `25565/tcp`

If you use `ufw`, allow at least:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 25565/tcp
```

If the Minecraft server is Bedrock, also allow its UDP port instead of assuming `25565/tcp`.

## Deploy on the VPS

Clone the repo onto the server, for example:

```bash
sudo mkdir -p /opt/wow-dashboard
sudo chown "$USER":"$USER" /opt/wow-dashboard
git clone <your-repo-url> /opt/wow-dashboard/app
cd /opt/wow-dashboard/app
```

Create the deploy env file:

```bash
cp deploy/self-hosted/.env.example deploy/self-hosted/.env
```

Edit `deploy/self-hosted/.env` and set:

- your real domains
- your email for TLS
- a long random `INSTANCE_SECRET`

Bring the stack up:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/docker-compose.yml \
  up -d --build
```

Check status:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/docker-compose.yml \
  ps
```

Check logs:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/docker-compose.yml \
  logs -f --tail=200
```

## Convex admin key

Generate the admin key on the server:

```bash
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/docker-compose.yml \
  exec backend ./generate_admin_key.sh
```

Keep the output somewhere safe. You will use it from your development machine, not from the browser.

The dashboard is intentionally local-only on the server. Access it through SSH port forwarding:

```bash
ssh -L 6791:127.0.0.1:6791 your-user@your-server
```

Then open:

```text
http://127.0.0.1:6791
```

## Local Convex CLI setup

On your development machine, set `packages/backend/.env.local` to target the self-hosted deployment:

```env
CONVEX_SELF_HOSTED_URL=https://api.example.com
CONVEX_SELF_HOSTED_ADMIN_KEY=<admin-key-from-server>
```

Then push your Convex functions and backend env vars:

```bash
cd packages/backend
npx convex env set SITE_URL https://app.example.com
npx convex env set BATTLENET_CLIENT_ID <your-battlenet-client-id>
npx convex env set BATTLENET_CLIENT_SECRET <your-battlenet-client-secret>
npx convex dev
```

## App env values

The web app image is built from these values in `deploy/self-hosted/.env`:

- `VITE_CONVEX_URL=https://<CONVEX_API_DOMAIN>`
- `VITE_CONVEX_SITE_URL=https://<CONVEX_SITE_DOMAIN>`

The runtime auth callback URL stored inside Convex must match:

- `SITE_URL=https://<APP_DOMAIN>`

Battle.net OAuth should use the public web domain, not the Convex site domain.

## Data migration

Before switching traffic, export your current hosted Convex data:

```bash
cd packages/backend
npx convex export --path ./backup.zip
```

After the self-hosted backend is up and your functions are pushed:

```bash
npx convex import --replace ./backup.zip
```

## Updating

Pull new code and rebuild only the web app:

```bash
git pull
docker compose \
  --env-file deploy/self-hosted/.env \
  -f deploy/self-hosted/docker-compose.yml \
  up -d --build web
```

Update Convex functions from your development machine:

```bash
cd packages/backend
npx convex dev
```

## Moving to another server

Keep migration simple:

1. Keep DNS pointed at hostnames, never raw IPs.
2. Copy `deploy/self-hosted/.env`.
3. Restore the repo on the new host.
4. Bring the stack up with the same compose command.
5. Re-point DNS.
6. Re-import a recent Convex export if the data volume is not being moved directly.

## Notes

- This setup uses Convex's default SQLite persistence via the Docker volume `convex_data`.
- That is the simplest starting point for a single VPS.
- If you outgrow it later, move Convex persistence to Postgres without changing the app architecture.
