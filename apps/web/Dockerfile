FROM node:24-alpine AS base
# A tripwire, not a setting: what runs on the server must not depend on the process time zone, and
# pinning it keeps the server from following whatever zone a host would inject. The browser renders
# in its own zone.
ENV TZ=UTC
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

# APP_VERSION is injected at build time by release.yml from the provenance gate's normalized tag
# (e.g. 3.0.0-rc.1). Falls back to the "dev" display sentinel when building without it, as CI's web
# build does; the web only labels the UI with it.
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

# Build @luke/db BEFORE the rest. Next no longer type-checks API source —
# apps/web resolves @luke/api through its built `exports` entry — but the
# emitted declaration graph still reaches the generated Prisma client: the
# router types are inferred from procedures whose returns carry Prisma model
# types. Removing this step degrades those types to `any` and fails the build
# under `strict`. `build` here is `prisma generate` plus the tsc that turns the
# generated source into the `dist` @luke/api and @luke/nav compile against.
RUN pnpm --filter @luke/db build

# Build shared packages first
RUN pnpm --filter @luke/core build
RUN pnpm --filter @luke/nav build
RUN pnpm --filter @luke/calendar build

# @luke/api publishes a built type contract (dist/index.d.ts) and nothing else
# resolves it: without this step `import type { AppRouter } from '@luke/api'`
# fails with TS2307 and the Next build stops at its type-check phase. Proven by
# deleting this line and watching the image build fail.
RUN pnpm --filter @luke/api build

# Build Next.js app. `output: 'standalone'` (next.config.js) writes the server
# and only the files its traces name to `.next/standalone`.
RUN pnpm --filter @luke/web build

# What the runtime stage is entitled to contain, at its final paths: the
# standalone tree, `.next/static` and `public`. The runner carries the list
# outside the tree it describes, and tools/scripts/check-image-runtime.ts — run
# by CI's `images` job and by the release before each push — fails on any entry
# under /app that is not on it.
RUN node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
    tools/scripts/check-image-runtime.ts web-inventory > /runtime-files.txt

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The standalone server: `apps/web/server.js` plus only the files Next traced —
# the server bundles, the packages they still require at runtime, and
# `apps/web/package.json`. No workspace `node_modules`, no `next` binary, and no
# `next.config.js`: the build embedded it. `@luke/core` is compiled into the
# bundles (`transpilePackages`), so it has no runtime copy either.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /runtime-files.txt /runtime-files.txt

# Neither @luke/api nor @luke/nav is in the image, and that is the point. Every
# apps/web import of @luke/api is `import type`, erased at build time, so no
# server bundle requires it and Next's traces never name it (measured: the
# standalone tree's only package link is `next`). The runner used to copy both,
# so that Next could type-check `apps/api/src` — a build-time dependency shipped
# into a runtime image. `checkWebRuntimeHasNoApiSource`
# (tools/scripts/check-platform-integrity.ts) still refuses a runner that copies
# API source.

# The standalone server binds to HOSTNAME. Docker sets it to the container id,
# which resolves to the container address alone, so a probe on 127.0.0.1 would
# find nothing; an image-defined value is not overridden.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
