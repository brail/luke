#!/bin/sh
set -e

echo "▶ Waiting for database..."
until node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.\$queryRaw\`SELECT 1\`.then(() => { p.\$disconnect(); process.exit(0); })
    .catch(() => { p.\$disconnect(); process.exit(1); });
" 2>/dev/null; do
  echo "  ⏳ Database not ready, retrying in 2s..."
  sleep 2
done

echo "▶ Applying database migrations..."
npx prisma migrate deploy

echo "▶ Starting API server..."
exec node --require ./dist/instrument.js dist/server.js
