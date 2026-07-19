# AGENTS

WoW Dashboard is a live, self-hosted World of Warcraft character dashboard. Treat changes as work
on a multi-user production system.

## Current Product

- Production is live at `https://wow.zirkumflex.io`.
- The active stack is `apps/api` + `apps/worker` + Postgres + Redis, with `apps/web` and `apps/app`
  as clients.
- Sign-in is Battle.net OAuth through Better Auth generic OAuth. `players.discordUserId` is metadata,
  not Discord OAuth authentication.
- Convex is not an active runtime. Only the historical importer, `legacy_convex_id` backfill fields,
  and the explicitly archived `deploy/self-hosted/` bundle remain.
- API services live in `apps/api/src/services/`; do not assume a different module layout.
- Automatic production deployment is intentionally paused during the server replacement.
  `.github/workflows/deploy-production.yml` must remain manual-only until the user explicitly asks
  to configure the new server and re-enable push deployment.

## Production Requirements

- Scope every query, mutation, cache key, job, and client state by authenticated user, player,
  account, or character as appropriate. Enforce ownership in the API route/service path, not only in
  the UI.
- Never expose or mutate another user's players, characters, snapshots, Mythic+ runs, sessions,
  accounts, or audit events.
- Keep addon ingest, Battle.net sync, imports, releases, and background jobs idempotent. Prefer
  natural keys, transactions, upserts, and duplicate collapse over cleanup later.
- Keep schema evolution backward-compatible with code that may still be running. Use
  expand/backfill/contract for risky migrations and preserve tested backup and rollback paths.
- Do not log secrets, OAuth or session tokens, raw authorization headers, or unnecessary personal
  data.
- Preserve rate limits, API readiness, worker health, audit events, structured logs, and safe UX for
  empty, stale, retrying, and partially failed states.
- Keep Battle.net login, addon ingest, and desktop/addon update validation working at every commit.
  Do not remove Battle.net OAuth without an explicit product decision and migration plan. If Discord
  OAuth is added, make it additive and account for Battle.net's `@battlenet.local` email mapping.

## Codex Workflow

- When model choice is available, use GPT-5.6 Sol for ambiguous, high-value production, security,
  data-integrity, or multi-step work. Use Terra for routine well-scoped work and Luna only for clear,
  repeatable, high-volume tasks. Use the lowest reasoning effort that produces a validated result;
  do not default every task to Max.
- For review, explanation, diagnosis, or planning, inspect and report without editing. For change,
  build, or fix requests, make the smallest in-scope local change and validate it.
- Trust current code and durable checked-in documentation. Read the files that own a behavior before
  editing; avoid broad rewrites unless the task requires one.
- Preserve existing routes, outputs, data contracts, user-visible behavior, unrelated worktree
  changes, and required functionality unless the request explicitly changes them.
- Commits, pushes, releases, deployments, secret changes, and production writes require an explicit
  user request. Destructive production data work also requires a verified recent backup and a dry
  run of the exact target rows.
- Before finishing, review the diff, run the narrowest relevant checks, and report what passed plus
  any remaining validation gap.

## Repository Routing

- [`README.md`](README.md): install, local development, and verification entry point
- [`deploy/README.md`](deploy/README.md): active manual deploy, backup, restore, and rollback flow
- [`apps/api/src/server.ts`](apps/api/src/server.ts), [`apps/api/src/auth.ts`](apps/api/src/auth.ts),
  and [`apps/api/src/services/`](apps/api/src/services/): routes, auth, authorization, and services
- [`apps/worker/src/worker.ts`](apps/worker/src/worker.ts): queue registration and worker health
- [`apps/addon/wow-dashboard.lua`](apps/addon/wow-dashboard.lua): in-game capture and SavedVariables
- [`apps/app/`](apps/app/): Electron client, local addon ingestion, and updater logic
- [`apps/web/src/routes/`](apps/web/src/routes/): TanStack Start routes
- [`packages/db/src/schema/`](packages/db/src/schema/), [`packages/api-schema/src/`](packages/api-schema/src/),
  and [`packages/api-client/src/`](packages/api-client/src/): persistence and shared API contracts
- [`apps/api/src/importConvexExport.ts`](apps/api/src/importConvexExport.ts): historical Convex importer

Files under `temp/` and `.tmp/` are ignored and never authoritative.
[`deploy/self-hosted/README.md`](deploy/self-hosted/README.md) is archive-only.

## Verification

Run the narrowest relevant command first, then broaden in proportion to risk:

```text
pnpm check
pnpm -F @wow-dashboard/addon test
pnpm -F app test
pnpm -F @wow-dashboard/api test
pnpm verify
```

- `pnpm check` runs workspace lint, formatting checks, and type checks. `pnpm verify` also runs tests
  and builds and requires Postgres and Redis configured like CI.
- API tests require `TEST_DATABASE_URL` or `DATABASE_URL` with a database name ending in `_test`; the
  suite must never truncate a non-test database.
- For schema changes, run `pnpm -F @wow-dashboard/db generate`, inspect the migration, apply it to a
  disposable or local database, and run the DB-backed API tests.
- Inspect live logs or SQL only when the user asks for production inspection. Keep production queries
  read-only unless a write is explicitly requested.
- For Electron production smoke tests, use the production `SITE_URL`, `API_URL`, `BETTER_AUTH_URL`,
  `VITE_SITE_URL`, and `VITE_API_URL` values documented in `deploy/README.md`.

## Release and Deploy

- App/addon releases may commit version bumps and publish GitHub assets. Do not trigger or rewrite
  release automation as part of an ordinary code change.
- Production deploy is manual-only. Before using it on the replacement server, update the GitHub
  environment secrets and host key, verify an off-server backup and restore, then dispatch it from
  `master`.
- `api` and `worker` run as bundled CommonJS under plain Node.js; the `migrate` image target is in
  `deploy/Dockerfile.api`.
- The historical importer command in the API container is:

```bash
node apps/api/dist/importConvexExport.cjs /tmp/<convex-export>.zip --apply
```
