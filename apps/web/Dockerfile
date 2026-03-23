FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Build stage ──────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# NEXT_PUBLIC_API_URL is baked into the client JS bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://luke.febos.local
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# INTERNAL_API_URL is used by next.config.js rewrites() which runs at build time.
# The value must be the Docker service name — overridable via --build-arg.
ARG INTERNAL_API_URL=http://api:3001
ENV INTERNAL_API_URL=$INTERNAL_API_URL

# APP_VERSION is injected at build time from the git tag (e.g. v1.2.3).
# Falls back to "dev" when building locally without a tag.
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY . .
RUN pnpm install --frozen-lockfile

# Generate Prisma client BEFORE building — Next.js type-checks API source
# files (via @luke/api path alias) which import from @prisma/client
RUN pnpm --filter @luke/api exec prisma generate

# Build shared packages first
RUN pnpm --filter @luke/core build
RUN pnpm --filter @luke/nav build

# Build Next.js app
RUN pnpm --filter @luke/web build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Workspace manifests
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./

# Root node_modules
COPY --from=builder /app/node_modules ./node_modules

# @luke/core — dist only
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist          ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules  ./packages/core/node_modules

# @luke/nav — dist only (importato da @luke/api/src per i tipi tRPC)
COPY --from=builder /app/packages/nav/package.json ./packages/nav/package.json
COPY --from=builder /app/packages/nav/dist          ./packages/nav/dist
COPY --from=builder /app/packages/nav/node_modules  ./packages/nav/node_modules

# @luke/api types (needed for tRPC type inference at runtime imports)
COPY --from=builder /app/apps/api/package.json  ./apps/api/package.json
COPY --from=builder /app/apps/api/src           ./apps/api/src
COPY --from=builder /app/apps/api/node_modules  ./apps/api/node_modules

# Next.js app — built output + public assets
COPY --from=builder /app/apps/web/package.json  ./apps/web/package.json
COPY --from=builder /app/apps/web/.next         ./apps/web/.next
COPY --from=builder /app/apps/web/public        ./apps/web/public
COPY --from=builder /app/apps/web/node_modules  ./apps/web/node_modules
COPY --from=builder /app/apps/web/next.config.js ./apps/web/next.config.js

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["pnpm", "start"]
