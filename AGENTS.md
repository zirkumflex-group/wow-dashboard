# AGENTS

This repo has moved to a self-hosted backend.

## Current Truth

- The active backend path is `apps/api` + `apps/worker` + Postgres + Redis.
- `apps/web` and `apps/app` should be treated as self-hosted clients first.
- The legacy Convex runtime has been removed from the active workspace.
- The remaining Convex-related code is the historical importer path plus `legacy_convex_id` fields used for backfills.
- Production is live at `https://wow.zirkumflex.io`.

## Important Paths

- [README.md](README.md): current repo usage
- [deploy/README.md](deploy/README.md): VPS/production deploy flow
- [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml): production-shaped stack
- [apps/api/src/importConvexExport.ts](apps/api/src/importConvexExport.ts): historical Convex export importer
- [temp/MIGRATION_PLAN.md](temp/MIGRATION_PLAN.md): active modular core/WoW + Discord auth checklist, intentionally untracked

## Working Rules

- Prefer changing the self-hosted path unless the task is explicitly about legacy Convex cleanup.
- Do not rely on files under `temp/` or `.tmp/` for durable project state. Both are ignored.
- Keep the migration plan only under `temp/MIGRATION_PLAN.md`. It is intentionally untracked.
- For the modular core/WoW + Discord auth refactor, follow `temp/MIGRATION_PLAN.md` and update phase checkboxes as work is completed.
- Each implementation phase must end with `pnpm check-types`, `pnpm check`, `pnpm -F @wow-dashboard/api test`, and a commit before the next phase starts.
- Phases 1-3 are behavior-preserving refactors. Keep Battle.net login, addon ingest, and scoreboard working at every commit.
- Do not remove the Battle.net OAuth provider. Discord is additive and Battle.net remains available for sign-in and character sync linking.
- Better Auth 1.6.9 exposes Discord through `better-auth/social-providers` and generic OAuth link at `POST /api/auth/oauth2/link`.
- A Discord user and a Battle.net account have different emails in this codebase, because Battle.net maps to `@battlenet.local`; explicit Battle.net linking must account for that Better Auth email check.
- For desktop production smoke tests, point Electron at production with:
  - `SITE_URL=https://wow.zirkumflex.io`
  - `API_URL=https://wow.zirkumflex.io/api`
  - `BETTER_AUTH_URL=https://wow.zirkumflex.io`
  - `VITE_SITE_URL=https://wow.zirkumflex.io`
  - `VITE_API_URL=https://wow.zirkumflex.io/api`

## Deploy Notes

- `api` and `worker` are bundled and run with plain `node` in production images.
- `migrate` uses the dedicated `migrate` build target from `deploy/Dockerfile.api`.
- The historical Convex import command in the running API container is:

```bash
node apps/api/dist/importConvexExport.cjs /tmp/<convex-export>.zip --apply
```
