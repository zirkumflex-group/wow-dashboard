# syntax=docker/dockerfile:1

# ---- base ----
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# ---- builder ----
FROM base AS builder
WORKDIR /app

# Copy manifests first for better layer caching.
# Changes to source files won't invalidate the install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json             ./apps/web/
COPY packages/backend/package.json     ./packages/backend/
COPY packages/config/package.json      ./packages/config/
COPY packages/env/package.json         ./packages/env/
COPY packages/ui/package.json          ./packages/ui/

# Install all workspace deps (devDeps included — needed for the build step).
RUN pnpm install --frozen-lockfile

# Copy source after install so the layer above stays cached on source changes.
COPY apps/web  ./apps/web
COPY packages  ./packages

# VITE_* vars are embedded into the client bundle at build time.
# Set them as Railway Build Variables; Railway passes them as --build-arg automatically.
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL

RUN pnpm --filter web build

# Prune to production-only node_modules for the web app.
# dist/ is in .gitignore so pnpm deploy won't include it — we copy it manually below.
RUN pnpm --filter web deploy --prod /deploy

# ---- runner ----
# Lean image: production node_modules + built assets only.
# The TanStack Start server (dist/server/server.js) is NOT self-contained —
# it imports react, @tanstack/react-router, etc. from node_modules at runtime.
# srvx/node (a prod dep via: web → @tanstack/react-start → h3 → srvx) handles
# the HTTP server and reads process.env.PORT automatically.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Production node_modules + package.json + start.mjs (from pnpm deploy).
COPY --from=builder /deploy ./

# dist/ is excluded by .gitignore, so pnpm deploy skips it — copy manually.
COPY --from=builder /app/apps/web/dist ./dist

EXPOSE 3000

# Railway injects PORT at runtime; srvx reads process.env.PORT (default: 3000).
CMD ["node", "start.mjs"]
