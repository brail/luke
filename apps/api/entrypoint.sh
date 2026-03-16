#!/bin/sh
set -e

echo "▶ Generating Prisma client..."
npx prisma generate

echo "▶ Applying database schema..."
# NOTE: 'db push' is used for the initial testing deployment (no migration history needed).
# When you are ready to track schema changes formally, replace this with:
#   npx prisma migrate deploy
# and generate migrations locally with:
#   pnpm --filter @luke/api exec prisma migrate dev --name init
npx prisma db push --skip-generate

echo "▶ Starting API server..."
exec node --require ./dist/instrument.js dist/server.js
