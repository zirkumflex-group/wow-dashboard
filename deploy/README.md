# VPS Deploy

This stack targets the staging hostname `wow-staging.zirkumflex.io` first and keeps the current
`wow.zirkumflex.io` production hostname untouched.

## Files

- `docker-compose.prod.yml`: staging/prod services for Caddy, web, api, worker, Postgres, and Redis
- `Caddyfile`: reverse proxy and automatic TLS for the staging hostname
- `.env.staging.example`: env template for the VPS

## First-time setup

1. Copy the staging env template:

   ```bash
   cp deploy/.env.staging.example deploy/.env.staging
   ```

2. Edit `deploy/.env.staging`:
   - set a real `BETTER_AUTH_SECRET`
   - set the Battle.net client ID and secret
   - change `POSTGRES_PASSWORD`

3. Point `wow-staging.zirkumflex.io` at the VPS IP and open inbound `80` and `443`.

4. Add the staging Battle.net callback URI:

   ```text
   https://wow-staging.zirkumflex.io/api/auth/oauth2/callback/battlenet
   ```

## Deploy

Build and start the full stack:

```bash
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml up -d --build
```

The `migrate` service runs Drizzle migrations before `api` and `worker` start.

## Manual VPS workflow

For now, the simplest flow is manual `rsync` plus `ssh vps`.

Sync the repo to the VPS:

```bash
rsync -az --progress \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.turbo/' \
  --exclude 'dist/' \
  --exclude 'build/' \
  --exclude '.output/' \
  --exclude '.env.local' \
  --exclude 'deploy/.env.staging' \
  --exclude '.imports/' \
  --exclude '.tmp/' \
  --exclude 'temp/' \
  --exclude 'tmp/' \
  --exclude 'packages/backend/' \
  ./ vps:~/wow-dashboard/
```

If you also want to move a historical Convex export ZIP for a backfill:

```bash
ssh vps 'mkdir -p ~/wow-dashboard/.imports'
rsync -az --progress \
  temp/<convex-export>.zip \
  vps:~/wow-dashboard/.imports/
```

Then SSH into the VPS and deploy:

```bash
ssh vps
cd ~/wow-dashboard
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml up -d --build
```

If you want to run the historical Convex import after deploy:

```bash
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml exec -T api \
  node apps/api/dist/importConvexExport.cjs \
  /tmp/<convex-export>.zip \
  --apply
```

Copy the ZIP into the `api` container first:

```bash
api_container=$(docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml ps -q api)
docker cp .imports/<convex-export>.zip "$api_container:/tmp/<convex-export>.zip"
```

## Useful commands

Tail logs:

```bash
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml logs -f caddy web api worker
```

Re-run migrations manually:

```bash
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml run --rm migrate
```

Stop the stack:

```bash
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml down
```

## Notes

- `docker-compose.prod.yml` now starts Caddy by default, so the main deploy command brings up the full public stack.
- Only Caddy publishes ports to the internet. Postgres and Redis stay internal to Docker.
- `api` and `worker` are bundled during the image build and run with plain `node` at runtime.
- The one-shot Convex importer is bundled into the API image from `apps/api/src/importConvexExport.ts` and is safe to rerun for historical backfills.
