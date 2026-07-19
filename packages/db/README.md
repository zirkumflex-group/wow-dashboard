# `@wow-dashboard/db`

Drizzle schema, migrations, and the shared Postgres client for the self-hosted stack.

## Local workflow

Start local Postgres:

```bash
docker compose -f deploy/docker-compose.dev.yml up -d postgres
```

Generate a migration after schema changes:

```bash
pnpm -F @wow-dashboard/db generate
```

Inspect the generated SQL under `packages/db/drizzle/` before applying it. Generated migrations are
checked in and must remain compatible with code that may still be running during deployment.

Apply the generated migration to local Postgres:

```bash
pnpm -F @wow-dashboard/db migrate
```

## Reset local Postgres

The following command destroys the repository's local development Postgres volume. Use it only for
the `deploy/docker-compose.dev.yml` stack, never for production or an unknown Compose project:

```bash
docker compose -f deploy/docker-compose.dev.yml down -v
docker compose -f deploy/docker-compose.dev.yml up -d postgres
pnpm -F @wow-dashboard/db migrate
```

## Dump and restore

These examples are for a local or disposable database. Production backups and restore tests must
use the guarded scripts documented in [`deploy/README.md`](../../deploy/README.md).

Create a dump from the current `DATABASE_URL`:

```bash
pg_dump --format=custom --file=/tmp/wowdash.dump "$DATABASE_URL"
```

Restore that dump into a fresh local database:

```bash
dropdb --if-exists --username=wowdash --host=localhost wowdash
createdb --username=wowdash --host=localhost wowdash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /tmp/wowdash.dump
```

After a schema change, migrate a disposable database and run the DB-backed API tests with a database
name ending in `_test`:

```bash
pnpm -F @wow-dashboard/db migrate
pnpm -F @wow-dashboard/api test
```
