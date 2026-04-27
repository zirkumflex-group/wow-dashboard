# Production Deploy

The active production stack runs at:

- Web: `https://wow.zirkumflex.io`
- API: `https://wow.zirkumflex.io/api`

The active backend is the self-hosted `api` + `worker` + Postgres + Redis stack. The old
hosted Convex deployment is only a historical import source.

## Files

- `docker-compose.prod.yml`: production services for Caddy, web, api, worker, Postgres, and Redis
- `Caddyfile`: reverse proxy and automatic TLS for `SITE_HOST`
- `.env.production.example`: production env template for the VPS
- `update-server.sh`: pull, build, migrate, and recreate the public stack
- `backup-postgres.sh`: create a custom-format Postgres backup
- `test-postgres-backup-restore.sh`: restore-test a backup in a temporary Postgres container
- `vacuum-analyze.sh`: run Postgres `VACUUM (ANALYZE)` after large imports

## Production Env

Create the production env file on the VPS:

```bash
cp deploy/.env.production.example deploy/.env.production
```

If the VPS still has the cutover-era `deploy/.env.staging`, rename it:

```bash
mv deploy/.env.staging deploy/.env.production
```

Then verify these values:

```env
SITE_HOST=wow.zirkumflex.io
SITE_URL=https://wow.zirkumflex.io
API_URL=https://wow.zirkumflex.io/api
BETTER_AUTH_URL=https://wow.zirkumflex.io
NODE_ENV=production
LOG_LEVEL=info
```

Also set real values for:

- `BETTER_AUTH_SECRET`
- `BATTLENET_CLIENT_ID`
- `BATTLENET_CLIENT_SECRET`
- `POSTGRES_PASSWORD`

The deploy tooling prefers `deploy/.env.production`. It still falls back to `deploy/.env.staging`
to avoid breaking an existing server during the rename window.

## DNS and Auth

Cloudflare should point `wow.zirkumflex.io` at the VPS IP.

Battle.net OAuth must include this callback:

```text
https://wow.zirkumflex.io/api/auth/oauth2/callback/battlenet
```

## Deploy

On the VPS:

```bash
cd ~/wow-dashboard
bash deploy/update-server.sh
```

The script:

- pulls the current branch with `--ff-only`
- builds `migrate`, `api`, `worker`, and `web`
- runs Drizzle migrations through the one-shot `migrate` service
- recreates `api`, `worker`, `web`, and `caddy`
- prints service status

If package or deploy metadata changed since the last successful deploy, it rebuilds without Docker
layer cache so stale install layers are not reused.

Useful overrides:

```bash
ENV_FILE=deploy/.env.production bash deploy/update-server.sh
PULL_BASE_IMAGES=1 bash deploy/update-server.sh
PULL_BASE_IMAGES=0 bash deploy/update-server.sh
SKIP_GIT_PULL=1 bash deploy/update-server.sh
```

## CI Auto Deploy

Production can be deployed automatically from GitHub Actions through
`.github/workflows/deploy-production.yml`.

The workflow runs on pushes to `master` that touch server, web, shared package, or deploy files. It:

1. installs dependencies
2. runs `pnpm run check-types`
3. SSHes into the VPS
4. runs `cd ~/wow-dashboard && bash deploy/update-server.sh`
5. checks `https://wow.zirkumflex.io/readyz`

Configure these GitHub repository secrets:

```text
PRODUCTION_SSH_HOST=<server-host-or-ip>
PRODUCTION_SSH_USER=Tristan
PRODUCTION_SSH_PORT=22
PRODUCTION_SSH_PRIVATE_KEY=<private deploy key>
PRODUCTION_SSH_KNOWN_HOSTS=<output from ssh-keyscan>
```

`PRODUCTION_SSH_PORT` is optional and defaults to `22`.

To enable automatic deploys on pushes to `master`, set this GitHub repository variable:

```text
PRODUCTION_AUTO_DEPLOY=true
```

Without that variable, the workflow still exists and can be run manually with `workflow_dispatch`,
but push-triggered deploys are skipped after verification.

Generate a dedicated deploy key on your local machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/wow-dashboard-production-deploy -C "wow-dashboard-production-deploy"
```

Install the public key on the VPS:

```bash
ssh-copy-id -i ~/.ssh/wow-dashboard-production-deploy.pub Tristan@<server-host>
```

Store the private key content as `PRODUCTION_SSH_PRIVATE_KEY`.

Store the server host key as `PRODUCTION_SSH_KNOWN_HOSTS`:

```bash
ssh-keyscan -H <server-host>
```

For extra control, put the deploy job in a GitHub `production` environment and require manual
approval before the SSH step.

## Health Checks

```bash
curl -fsS https://wow.zirkumflex.io/readyz
curl -fsS https://wow.zirkumflex.io/robots.txt

docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml ps
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml logs -f caddy web api worker
```

Only Caddy publishes public ports. Postgres and Redis stay internal to Docker.

## Backups

Run an immediate backup:

```bash
cd ~/wow-dashboard
bash deploy/backup-postgres.sh
```

By default backups are written to:

```text
~/wow-dashboard-backups/postgres
```

The script writes:

- `wowdash-<timestamp>.dump`
- `wowdash-<timestamp>.dump.sha256`
- `latest.dump` symlink
- `latest.dump.sha256` symlink

Retention defaults to 14 days. Override it with:

```bash
RETENTION_DAYS=30 bash deploy/backup-postgres.sh
```

To copy each backup off-server, set `REMOTE_BACKUP_TARGET`:

```bash
REMOTE_BACKUP_TARGET='backup-user@backup-host:/srv/backups/wow-dashboard/postgres/' \
  bash deploy/backup-postgres.sh
```

Daily cron example:

```cron
15 3 * * * cd /home/Tristan/wow-dashboard && REMOTE_BACKUP_TARGET='backup-user@backup-host:/srv/backups/wow-dashboard/postgres/' bash deploy/backup-postgres.sh >> /home/Tristan/wow-dashboard-backups/postgres/backup.log 2>&1
```

Adjust the username/path if the VPS checkout is not under `/home/Tristan/wow-dashboard`.

## Restore Test

After the first backup, test that it restores:

```bash
cd ~/wow-dashboard
bash deploy/test-postgres-backup-restore.sh ~/wow-dashboard-backups/postgres/latest.dump
```

This starts a temporary `postgres:16-alpine` container, restores the dump, prints row counts for
the key tables, and removes the test container.

## Historical Convex Import

The one-shot importer is bundled into the API image. Copy the Convex export ZIP into the API
container first:

```bash
cd ~/wow-dashboard
api_container=$(docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml ps -q api)
docker cp .imports/<convex-export>.zip "$api_container:/tmp/<convex-export>.zip"
```

Run the import:

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml exec -T api \
  node apps/api/dist/importConvexExport.cjs \
  /tmp/<convex-export>.zip \
  --apply
```

Do not pass `--include-sessions` for the production backfill. Old Convex sessions are not useful
after the cutover.

The importer is designed to be rerunnable. It deduplicates by legacy Convex IDs and natural keys
such as Battle.net account, character identity, snapshot timestamp, daily snapshot day, and
Mythic+ run identifiers.

After a large import, refresh Postgres planner stats:

```bash
bash deploy/vacuum-analyze.sh
```

## Rollback

For application regressions:

```bash
cd ~/wow-dashboard
git log --oneline -10
git checkout <known-good-commit>
SKIP_GIT_PULL=1 bash deploy/update-server.sh
git switch master
```

`SKIP_GIT_PULL=1` is only for emergency rollback deploys from a checked-out commit. Normal deploys
should let `update-server.sh` pull the current production branch.

For data regressions, stop the app writers before restoring a database backup:

```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml stop api worker web
```

Then restore from a verified `pg_dump --format=custom` backup using `pg_restore`. Prefer testing
the exact backup first with `deploy/test-postgres-backup-restore.sh`.
