# AGENTS

WoW Dashboard is a live self-hosted WoW character dashboard. Optimize work for a stable,
multi-user production system.

## Current Truth

- Production is live at `https://wow.zirkumflex.io`.
- The active backend is `apps/api` + `apps/worker` + Postgres + Redis.
- `apps/web` and `apps/app` are self-hosted clients for the active backend.
- The legacy Convex runtime is not active. Remaining Convex code is the historical importer and
  `legacy_convex_id` fields used for backfills.
- Current API services are still in the flat `apps/api/src/services/` layout. Do not assume
  `apps/api/src/modules/` exists unless the current worktree shows it.
- Current sign-in is Battle.net OAuth through Better Auth generic OAuth. `players.discordUserId`
  is Discord metadata, not Discord OAuth sign-in, unless a later change explicitly adds it.

## Current Goal

Move the product from single-team/self-hosted usage toward stable multi-user production.

Prioritize:

- User and player data isolation.
- Correct authorization on every read and mutation.
- Idempotent addon ingest, Battle.net sync, imports, and background jobs.
- Safe schema evolution, backups, and rollback paths.
- Clear operational signals: health checks, audit events, logs, and rate limits.
- Production-safe UX for empty states, stale data, retries, and partial failures.

## GPT-5.5 / Codex Operating Rules

- When model choice is available, prefer GPT-5.5 for complex coding, production debugging, security,
  data integrity, and multi-step refactors. Use smaller variants only for simple mechanical edits.
- Keep instructions concrete and non-conflicting. If repo files disagree with plans or notes,
  trust the current code and durable docs first.
- Use targeted context gathering. Read the files that own the behavior before editing; avoid
  broad rewrites unless the task explicitly requires them.
- Make the smallest production-safe change that solves the problem, then verify it.
- When a reasonable assumption is needed, proceed and state it in the final response. Ask only
  when the next step would be destructive, security-sensitive, or impossible to infer.
- Prefer durable tests and code over explanations. Do not leave behavior changes only in notes.
- Preserve user work in the git tree. Do not revert unrelated changes.
- Keep final responses short and concrete: what changed, what was verified, and any remaining risk.

## Important Paths

- [README.md](README.md): current repo usage and local development
- [deploy/README.md](deploy/README.md): VPS and production deploy flow
- [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml): production-shaped stack
- [deploy/update-server.sh](deploy/update-server.sh): production update script
- [apps/api/src/server.ts](apps/api/src/server.ts): API routes and middleware
- [apps/api/src/auth.ts](apps/api/src/auth.ts): Better Auth and Battle.net OAuth
- [apps/api/src/services/](apps/api/src/services/): API service layer
- [apps/api/src/importConvexExport.ts](apps/api/src/importConvexExport.ts): historical Convex export importer
- [apps/worker/src/worker.ts](apps/worker/src/worker.ts): background jobs
- [apps/addon/wow-dashboard.lua](apps/addon/wow-dashboard.lua): in-game addon snapshot and Mythic+ capture
- [apps/web/src/routes/](apps/web/src/routes/): TanStack Start web routes
- [apps/app/](apps/app/): Electron desktop client
- [packages/db/src/schema/](packages/db/src/schema/): Drizzle schema
- [packages/api-schema/src/](packages/api-schema/src/): shared API schemas
- [packages/api-client/src/](packages/api-client/src/): frontend API client helpers

## Production Safety Rules

- Treat every request as multi-user. Scope queries, mutations, cache keys, jobs, and UI state by
  authenticated user, player, character, or account as appropriate.
- Never expose or mutate another user's `players`, `characters`, snapshots, Mythic+ runs, sessions,
  accounts, or audit events.
- Do authorization checks in the API service/route path, not only in the UI.
- Avoid global mutable state for user-specific data. If caching is added, include explicit tenant
  scope and invalidation.
- Make ingest and sync paths idempotent. Prefer natural keys, transactions, upserts, and duplicate
  collapse logic over best-effort cleanup later.
- Migrations must be backward-compatible with currently running code unless the deploy plan includes
  a coordinated stop/restart. Use expand/backfill/contract for risky data changes.
- Before destructive production data changes, require an explicit user request, take or verify a
  recent backup, and dry-run the target rows.
- Do not log secrets, OAuth tokens, session tokens, raw auth headers, or unnecessary personal data.
- Keep rate limits and ready/health checks working when changing API, worker, Redis, or Postgres code.

## Working Rules

- Prefer the self-hosted path unless the task explicitly says legacy Convex.
- Do not rely on files under `temp/` or `.tmp/` for durable project state. Both are ignored.
- Treat `temp/MIGRATION_PLAN.md` as optional historical/current planning context only when the user
  explicitly asks for that refactor. Verify the current tree before following any checklist there.
- Keep Battle.net login, addon ingest, scoreboard, and production deploy working at every commit.
- Do not remove Battle.net OAuth without an explicit product decision and migration plan.
- If adding Discord OAuth later, make it additive unless explicitly told otherwise, and account for
  Battle.net's `@battlenet.local` email mapping during account linking.
- For desktop production smoke tests, point Electron at production with:
  - `SITE_URL=https://wow.zirkumflex.io`
  - `API_URL=https://wow.zirkumflex.io/api`
  - `BETTER_AUTH_URL=https://wow.zirkumflex.io`
  - `VITE_SITE_URL=https://wow.zirkumflex.io`
  - `VITE_API_URL=https://wow.zirkumflex.io/api`

## Verification

- Run the narrowest useful check first, then broaden when risk justifies it.
- Standard checks:
  - `pnpm check-types`
  - `pnpm check`
  - `pnpm -F @wow-dashboard/api test`
- For DB-backed API tests, use a `TEST_DATABASE_URL` or `DATABASE_URL` whose database name ends with
  `_test`. The test suite must not truncate a non-test database.
- For DB schema changes, run `pnpm -F @wow-dashboard/db generate` and inspect generated migrations.
- For production-facing fixes, also consider targeted VPS inspection, logs, or SQL read-only queries
  when the user asks to inspect production.

## Deploy Notes

- `api` and `worker` are bundled and run with plain `node` in production images.
- `migrate` uses the dedicated `migrate` build target from `deploy/Dockerfile.api`.
- The historical Convex import command in the running API container is:

```bash
node apps/api/dist/importConvexExport.cjs /tmp/<convex-export>.zip --apply
```
