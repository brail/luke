FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Build stage ──────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copy full workspace (pnpm symlinks require the entire tree)
COPY . .

RUN pnpm install --frozen-lockfile

# Generate Prisma client BEFORE tsc — TypeScript needs the generated types to compile
RUN pnpm --filter @luke/api exec prisma generate

# Build shared packages first, then the API
RUN pnpm --filter @luke/core build
RUN pnpm --filter @luke/nav build
RUN pnpm --filter @luke/calendar build
RUN pnpm --filter @luke/api build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# APP_VERSION is injected at build time from the git tag (e.g. v1.2.3).
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Workspace manifests (needed for pnpm resolution at runtime)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./

# Root node_modules (shared deps + pnpm virtual store)
COPY --from=builder /app/node_modules ./node_modules

# @luke/core — only the compiled dist is needed at runtime
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist          ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules  ./packages/core/node_modules

# @luke/nav — NAV sync runtime
COPY --from=builder /app/packages/nav/package.json ./packages/nav/package.json
COPY --from=builder /app/packages/nav/dist          ./packages/nav/dist
COPY --from=builder /app/packages/nav/node_modules  ./packages/nav/node_modules

# @luke/calendar — calendar export runtime
COPY --from=builder /app/packages/calendar/package.json ./packages/calendar/package.json
COPY --from=builder /app/packages/calendar/dist          ./packages/calendar/dist
COPY --from=builder /app/packages/calendar/node_modules  ./packages/calendar/node_modules

# @luke/api — compiled output + prisma schema + runtime deps
COPY --from=builder /app/apps/api/package.json    ./apps/api/package.json
COPY --from=builder /app/apps/api/dist            ./apps/api/dist
COPY --from=builder /app/apps/api/prisma          ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules    ./apps/api/node_modules

# Email templates (plain text — tsc does not copy non-TS files)
COPY --from=builder /app/apps/api/src/templates   ./apps/api/dist/templates

# Entrypoint script
COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/api
EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
