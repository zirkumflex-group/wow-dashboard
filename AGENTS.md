# AGENTS

This repo has moved to a self-hosted backend.

## Current Truth

- The active backend path is `apps/api` + `apps/worker` + Postgres + Redis.
- `apps/web` and `apps/app` should be treated as self-hosted clients first.
- The legacy Convex runtime has been removed from the active workspace.
- The remaining Convex-related code is the importer path plus `legacy_convex_id` fields used for historical backfills.
- Staging is live at `https://wow-staging.zirkumflex.io`.

## Important Paths

- [README.md](/home/yungtristxn/VibeCoding/wow-dashboard/README.md:1): current repo usage
- [deploy/README.md](/home/yungtristxn/VibeCoding/wow-dashboard/deploy/README.md:1): VPS/staging deploy flow
- [deploy/docker-compose.prod.yml](/home/yungtristxn/VibeCoding/wow-dashboard/deploy/docker-compose.prod.yml:1): production-shaped stack
- [apps/api/src/importConvexExport.ts](/home/yungtristxn/VibeCoding/wow-dashboard/apps/api/src/importConvexExport.ts:1): Convex export importer

## Working Rules

- Prefer changing the self-hosted path unless the task is explicitly about legacy Convex cleanup.
- Do not rely on files under `temp/` for durable project state. `temp/` is ignored.
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
- The Convex import command in the running API container is:

```bash
node apps/api/dist/importConvexExport.cjs /tmp/<convex-export>.zip --apply
```
