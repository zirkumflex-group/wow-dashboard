# `@wow-dashboard/api`

Self-hosted Hono API for the active backend.

## Recommended local stack

From the repository root, copy the environment template, fill in the Battle.net credentials, and
start the complete development stack:

```powershell
Copy-Item .env.example .env.local
pnpm dev
```

The root launcher starts Postgres and Redis, applies migrations, and runs the API, worker, web app,
and Electron client. Use the steps below when you specifically need to run the API by itself.

## Local auth verification

1. Copy the root env template and fill in the Battle.net credentials:

```powershell
Copy-Item .env.example .env.local
```

2. Set a real `BETTER_AUTH_SECRET` and the Battle.net OAuth credentials in `.env.local`.

3. Add this redirect URI to the Battle.net application:

```text
http://localhost:3000/api/auth/oauth2/callback/battlenet
```

4. Start local infrastructure and apply migrations:

```bash
docker compose -f deploy/docker-compose.dev.yml up -d postgres redis
pnpm -F @wow-dashboard/db migrate
```

5. Start the API:

```bash
pnpm -F @wow-dashboard/api dev
```

6. Open the local auth probe:

```text
http://localhost:3000/dev/auth
```

The probe will:

- start the Battle.net OAuth flow
- show the current Better Auth session
- show the rebound `players` row for the logged-in user
- expose the development-only bearer token so `/api/me` can be re-tested with `Authorization: Bearer ...`

Stop local infra when finished:

```bash
docker compose -f deploy/docker-compose.dev.yml down
```

## DB-backed tests

The API test suite truncates its database between cases and therefore refuses to run unless the
database name ends in `_test`. Never point it at a development or production database.

With local Postgres running, use a dedicated test database URL in the current PowerShell 7 session:

```powershell
$env:DATABASE_URL = "postgres://wowdash:wowdash@localhost:5432/wow_dashboard_test"
$env:TEST_DATABASE_URL = $env:DATABASE_URL
pnpm -F @wow-dashboard/db migrate
pnpm -F @wow-dashboard/api test
```

Create the `wow_dashboard_test` database first if it does not exist. Redis must be available at the
configured `REDIS_URL` for queue and rate-limit coverage.
