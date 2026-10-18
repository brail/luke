#!/bin/sh
set -e

echo "▶ Waiting for database..."
until node -e "
  const { createPrismaClient } = require('@luke/db');
  const p = createPrismaClient();
  p.\$queryRaw\`SELECT 1\`.then(() => { p.\$disconnect(); process.exit(0); })
    .catch(() => { p.\$disconnect(); process.exit(1); });
" 2>/dev/null; do
  echo "  ⏳ Database not ready, retrying in 2s..."
  sleep 2
done

echo "▶ Applying database migrations..."
# The schema, the migrations and prisma.config.ts live in @luke/db, and the CLI
# resolves all three from that package's directory — not from this WORKDIR.
(cd /app/packages/db && npx prisma migrate deploy)

echo "▶ Starting API server..."
exec node --require ./dist/instrument.js dist/server.js
