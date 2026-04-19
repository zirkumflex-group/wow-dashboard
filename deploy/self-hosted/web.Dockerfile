FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL

ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL

RUN pnpm --filter web build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production

COPY --from=build /app/apps/web/.output /app/apps/web/.output

EXPOSE 3000

CMD ["node", "apps/web/.output/server/index.mjs"]
