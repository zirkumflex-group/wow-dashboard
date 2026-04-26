# `@wow-dashboard/api`

Self-hosted Hono API for the active backend.

## Local auth verification

1. Copy the root env template and fill in the Battle.net credentials:

```bash
cp .env.example .env.local
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
