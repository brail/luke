FROM node:24-alpine AS base
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

# next build's type-checking phase OOMs on V8's default old-space heap
# (~2GB) in memory-constrained build environments (small CI runners, a
# Docker Desktop VM shared with other containers). Raise it explicitly
# rather than relying on V8's auto-detected default.
ENV NODE_OPTIONS=--max-old-space-size=4096

# Build-time only placeholder: /api/auth/[...nextauth] is imported during
# Next 16's page-data collection, which evaluates NextAuth(config) eagerly.
# Discarded — runner stage doesn't inherit builder ENV; real value comes
# from docker-compose at container start.
ENV NEXTAUTH_SECRET=build-time-placeholder-unused-at-runtime

COPY . .
RUN pnpm install --frozen-lockfile

# Generate the Prisma client BEFORE building. Next no longer type-checks API
# source — apps/web resolves @luke/api through its built `exports` entry — but
# the emitted declaration graph still reaches @prisma/client: the router types
# are inferred from procedures whose returns carry Prisma model types. Removing
# this step degrades those types to `any` and fails the build under `strict`.
RUN pnpm --filter @luke/api exec prisma generate

# Build shared packages first
RUN pnpm --filter @luke/core build
RUN pnpm --filter @luke/nav build
RUN pnpm --filter @luke/calendar build

# @luke/api publishes a built type contract (dist/index.d.ts) and nothing else
# resolves it: without this step `import type { AppRouter } from '@luke/api'`
# fails with TS2307 and the Next build stops at its type-check phase. Proven by
# deleting this line and watching the image build fail.
RUN pnpm --filter @luke/api build

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

# Neither @luke/api nor @luke/nav is copied here, and that is the point.
#
# Both used to be, so that Next could type-check `apps/api/src` — @luke/api
# pointed `main`/`types` at its own TypeScript sources, and @luke/nav came along
# because those sources import it. Every one of apps/web's @luke/api imports is
# `import type`, so all of it is erased at build time: the emitted bundle
# contains no `require("@luke/api")` at all, and the runner never loaded a byte
# of it. The copies were a build-time dependency shipped into a runtime image.
#
# Verified rather than assumed: this image runs with `apps/api` absent from the
# filesystem — apps/web/node_modules/@luke/api is a dangling symlink — serving
# SSR pages, the NextAuth route handlers, and tRPC calls proxied to the API
# container. Type inference is a compile-time activity; there are no runtime
# imports to satisfy.

# Next.js app — built output + public assets
COPY --from=builder /app/apps/web/package.json  ./apps/web/package.json
COPY --from=builder /app/apps/web/.next         ./apps/web/.next
COPY --from=builder /app/apps/web/public        ./apps/web/public
COPY --from=builder /app/apps/web/node_modules  ./apps/web/node_modules
COPY --from=builder /app/apps/web/next.config.js ./apps/web/next.config.js

WORKDIR /app/apps/web
EXPOSE 3000

CMD ["./node_modules/.bin/next", "start"]
