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

# Build shared packages first, then the API
RUN pnpm --filter @luke/core build
RUN pnpm --filter @luke/api build

# Generate Prisma client for the production target (postgresql)
RUN pnpm --filter @luke/api exec prisma generate

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests (needed for pnpm resolution at runtime)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./

# Root node_modules (shared deps + pnpm virtual store)
COPY --from=builder /app/node_modules ./node_modules

# @luke/core — only the compiled dist is needed at runtime
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist          ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules  ./packages/core/node_modules

# @luke/api — compiled output + prisma schema + runtime deps
COPY --from=builder /app/apps/api/package.json    ./apps/api/package.json
COPY --from=builder /app/apps/api/dist            ./apps/api/dist
COPY --from=builder /app/apps/api/prisma          ./apps/api/prisma
COPY --from=builder /app/apps/api/node_modules    ./apps/api/node_modules

# Entrypoint script
COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/apps/api
EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
