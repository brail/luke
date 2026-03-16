FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Build stage ──────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# NEXT_PUBLIC_API_URL is baked into the client JS bundle at build time.
# Pass the production public hostname via --build-arg.
ARG NEXT_PUBLIC_API_URL=http://luke.febos.local
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY . .
RUN pnpm install --frozen-lockfile

# Build shared packages first
RUN pnpm --filter @luke/core build

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
