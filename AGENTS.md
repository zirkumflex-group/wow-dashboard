# AGENTS

This repo has moved to a self-hosted backend.

## Current Truth

- The active backend path is `apps/api` + `apps/worker` + Postgres + Redis.
- `apps/web` and `apps/app` should be treated as self-hosted clients first.
- The legacy Convex runtime has been removed from the active workspace.
- The remaining Convex-related code is the historical importer path plus `legacy_convex_id` fields used for backfills.
- Staging is live at `https://wow-staging.zirkumflex.io`.

## Important Paths

- [README.md](README.md): current repo usage
- [deploy/README.md](deploy/README.md): VPS/staging deploy flow
- [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml): production-shaped stack
- [apps/api/src/importConvexExport.ts](apps/api/src/importConvexExport.ts): historical Convex export importer

## Working Rules

- Prefer changing the self-hosted path unless the task is explicitly about legacy Convex cleanup.
- Do not rely on files under `temp/` or `.tmp/` for durable project state. Both are ignored.
- Keep the migration plan only under `temp/MIGRATION_PLAN.md`. It is intentionally untracked.
- For desktop staging tests, point Electron at staging with:
  - `SITE_URL=https://wow-staging.zirkumflex.io`
  - `API_URL=https://wow-staging.zirkumflex.io/api`
  - `BETTER_AUTH_URL=https://wow-staging.zirkumflex.io`
  - `VITE_SITE_URL=https://wow-staging.zirkumflex.io`
  - `VITE_API_URL=https://wow-staging.zirkumflex.io/api`

## Deploy Notes

- `api` and `worker` are bundled and run with plain `node` in production images.
- `migrate` uses the dedicated `migrate` build target from `deploy/Dockerfile.api`.
- The historical Convex import command in the running API container is:

```bash
node apps/api/dist/importConvexExport.cjs /tmp/<convex-export>.zip --apply
```
