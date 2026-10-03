# syntax=docker/dockerfile:1
# One file, one target per deployable: api, redirect, worker, migrate, web.
#   docker build --target api -t goshort-api .
# Base images: Debian slim (glibc) so the native Argon2 build is used as published.
ARG NODE_VERSION=22
ARG CADDY_VERSION=2

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false

# ---- all dependencies (dev included), cached on the manifests only ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/redirect/package.json apps/redirect/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/console/package.json apps/console/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/validation/package.json packages/validation/
COPY tests/package.json tests/
# Scripts are skipped (the Prisma client is generated explicitly below, after the schema is copied).
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ---- build every bundle ----
FROM deps AS build
COPY . .
RUN npm run db:generate \
 && npm run build -w @go-short/api -w @go-short/redirect -w @go-short/worker -w @go-short/web -w @go-short/console

# ---- production-only node_modules per service (externals such as argon2, pg, bullmq) ----
# `@prisma/client` declares the Prisma CLI as an OPTIONAL peer, which npm installs anyway because a dev
# workspace uses it. The CLI (and what only it needs) is removed: the running services never load it.
FROM base AS prod-deps-api
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/validation/package.json packages/validation/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts -w @go-short/api \
 && rm -rf node_modules/prisma node_modules/typescript node_modules/react node_modules/react-dom \
    node_modules/elkjs node_modules/@electric-sql \
    node_modules/@prisma/studio-core node_modules/@prisma/dev node_modules/@prisma/config \
    node_modules/@prisma/engines node_modules/@prisma/fetch-engine node_modules/@prisma/engines-version \
    node_modules/@prisma/get-platform node_modules/@prisma/streams-local node_modules/@prisma/query-plan-executor

FROM base AS prod-deps-redirect
COPY package.json package-lock.json ./
COPY apps/redirect/package.json apps/redirect/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts -w @go-short/redirect \
 && rm -rf node_modules/prisma node_modules/typescript node_modules/react node_modules/react-dom \
    node_modules/elkjs node_modules/@electric-sql \
    node_modules/@prisma/studio-core node_modules/@prisma/dev node_modules/@prisma/config \
    node_modules/@prisma/engines node_modules/@prisma/fetch-engine node_modules/@prisma/engines-version \
    node_modules/@prisma/get-platform node_modules/@prisma/streams-local node_modules/@prisma/query-plan-executor

FROM base AS prod-deps-worker
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts -w @go-short/worker \
 && rm -rf node_modules/prisma node_modules/typescript node_modules/react node_modules/react-dom \
    node_modules/elkjs node_modules/@electric-sql \
    node_modules/@prisma/studio-core node_modules/@prisma/dev node_modules/@prisma/config \
    node_modules/@prisma/engines node_modules/@prisma/fetch-engine node_modules/@prisma/engines-version \
    node_modules/@prisma/get-platform node_modules/@prisma/streams-local node_modules/@prisma/query-plan-executor

# ---- runtime base: non-root, production mode, writable data dir owned by the app user ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data/storage /data/geoip && chown -R node:node /data
USER node

FROM runtime AS api
COPY --from=prod-deps-api --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
ENV API_PORT=4000 STORAGE_PATH=/data/storage
EXPOSE 4000 9101
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM runtime AS redirect
COPY --from=prod-deps-redirect --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/redirect/dist ./dist
ENV REDIRECT_PORT=4001
EXPOSE 4001 9102
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REDIRECT_PORT||4001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM runtime AS worker
COPY --from=prod-deps-worker --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/worker/dist ./dist
ENV STORAGE_PATH=/data/storage GEOIP_DATABASE_PATH=/data/geoip/dbip-city-lite.mmdb
EXPOSE 9103
# The worker has no public port; liveness is "the metrics port answers" (needs METRICS_ENABLED=true).
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_METRICS_PORT||9103)+'/metrics',{headers:process.env.METRICS_TOKEN?{authorization:'Bearer '+process.env.METRICS_TOKEN}:{}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# ---- one-shot database migrations (the Prisma CLI lives here, never in a runtime image) ----
FROM deps AS migrate
# The Prisma CLI wants OpenSSL and write access to its own engine directory.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R node:node /app/node_modules/@prisma /app/node_modules/prisma
COPY packages/database packages/database
WORKDIR /app/packages/database
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- static web app + Caddy (TLS, routing, security headers) ----
FROM caddy:${CADDY_VERSION}-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY --from=build /app/apps/console/dist /srv/console
COPY docker/caddy/Caddyfile docker/caddy/Caddyfile.http /etc/caddy/
EXPOSE 80 443
