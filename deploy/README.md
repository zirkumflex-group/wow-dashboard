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

- Only Caddy publishes ports to the internet. Postgres and Redis stay internal to Docker.
- `api` and `worker` currently start through `tsx` because the workspace packages still export
  TypeScript source files. That is intentional for this staging deploy; switching them back to a
  pure `node dist/*` runtime will require a separate packaging cleanup.
