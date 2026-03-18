#!/bin/sh
set -e

echo "▶ Applying database migrations..."
npx prisma migrate deploy

echo "▶ Starting API server..."
exec node --require ./dist/instrument.js dist/server.js
