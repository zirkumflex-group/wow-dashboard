# wow-dashboard

WoW Dashboard is a self-hosted WoW character dashboard with:

- `apps/web` for the browser UI
- `apps/app` for the Electron desktop client
- `apps/addon` for snapshot generation inside WoW
- `apps/api` + `apps/worker` for the self-hosted backend
- Postgres + Redis for persistence, jobs, and rate limiting

The legacy Convex runtime has been removed from the active workspace. The remaining Convex-related code is the one-shot importer plus `legacy_convex_id` mapping retained for historical backfills.

## Current Status

- Staging stack is running at `https://wow-staging.zirkumflex.io`
- Battle.net auth works on staging
- The production Convex export has been imported into the staging Postgres database
- The remaining work is mainly desktop/addon validation and deploy hardening

## Repository Layout

```text
wow-dashboard/
├── apps/
│   ├── api/      # Hono API + Better Auth + import tooling
│   ├── app/      # Electron desktop app
│   ├── web/      # TanStack Start web app
│   ├── worker/   # pg-boss worker
│   └── addon/    # WoW addon
├── packages/
│   ├── api-client/
│   ├── api-schema/
│   ├── db/
│   ├── env/
│   └── ui/
└── deploy/
    ├── docker-compose.dev.yml
    ├── docker-compose.prod.yml
    ├── Dockerfile.api   # shared api/worker/migrate build
    ├── Dockerfile.web
    └── Caddyfile
```

## Local Development

Install dependencies:

```bash
pnpm install
```

Create local env from the repo root:

```bash
cp .env.example .env.local
```

Start local Postgres + Redis:

```bash
docker compose -f deploy/docker-compose.dev.yml up -d postgres redis
```

Apply migrations:

```bash
pnpm -F @wow-dashboard/db migrate
```

Run the core services:

```bash
pnpm -F @wow-dashboard/api dev
pnpm -F @wow-dashboard/worker dev
pnpm -F web dev
```

Optional desktop app dev:

```bash
pnpm -F app dev
```

Useful local URLs:

- Web: `http://localhost:3001`
- API: `http://localhost:3000`
- Auth probe: `http://localhost:3000/dev/auth`

## Electron Against Staging

For a staging desktop smoke test, run the Electron app with staging env overrides:

```bash
SITE_URL=https://wow-staging.zirkumflex.io \
API_URL=https://wow-staging.zirkumflex.io/api \
BETTER_AUTH_URL=https://wow-staging.zirkumflex.io \
VITE_SITE_URL=https://wow-staging.zirkumflex.io \
VITE_API_URL=https://wow-staging.zirkumflex.io/api \
pnpm -F app dev
```

## VPS / Staging Deploy

Use the deploy guide in [deploy/README.md](/home/yungtristxn/VibeCoding/wow-dashboard/deploy/README.md:1).

The current production-shaped stack is:

- `caddy`
- `web`
- `api`
- `worker`
- `postgres`
- `redis`

Bring it up on the VPS with:

```bash
docker compose --profile edge --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml up -d --build
```

## Convex Import

The one-shot importer is bundled into the API image and can be rerun safely:

```bash
docker compose --profile edge --env-file deploy/.env.staging -f deploy/docker-compose.prod.yml exec -T api \
  node apps/api/dist/importConvexExport.cjs \
  /tmp/<convex-export>.zip \
  --apply
```

## Checks

- Lint + format: `pnpm check`
- Typecheck: `pnpm check-types`
- API typecheck only: `pnpm -F @wow-dashboard/api check-types`
