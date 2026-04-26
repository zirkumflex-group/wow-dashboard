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

Apply the generated migration to local Postgres:

```bash
pnpm -F @wow-dashboard/db migrate
```

## Reset local Postgres

Reset the local database volume when you need a clean rehearsal database:

```bash
docker compose -f deploy/docker-compose.dev.yml down -v
docker compose -f deploy/docker-compose.dev.yml up -d postgres
pnpm -F @wow-dashboard/db migrate
```

## Dump and restore

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
