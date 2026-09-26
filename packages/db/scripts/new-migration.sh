#!/usr/bin/env bash
#
# new-migration.sh — generates a versioned migration and applies it to the development database.
#
# Why a script and not four commands in a .md: the procedure needs a disposable Postgres (the
# development DB was aligned with `db push`, so `migrate dev` would see it as drifted and offer to
# reset it), and the right commands changed with Prisma 7 — `--skip-seed` no longer exists, and
# the CLI no longer loads `.env` on its own. A hand-written procedure rots; this one fails loudly
# if something is off.
#
# Usage:
#   pnpm --filter @luke/db db:migrate:new <descriptive_name>
#
# When it finishes, commit the file in prisma/migrations/ together with the .prisma changes.

set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "❌ Missing migration name. Usage: pnpm --filter @luke/db db:migrate:new <descriptive_name>" >&2
  exit 1
fi

CONTAINER="luke-pg-migrate"
SHADOW_PORT=5433
SHADOW_URL="postgresql://luke:luke@localhost:${SHADOW_PORT}/luke"

# `--rm` alone is not enough: if the script dies between `docker run` and `docker stop`, the
# container stays up, and the busy port fails the next run with an error that does not name it.
cleanup() {
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "🐘 Temporary Postgres on port ${SHADOW_PORT}…"
docker run --rm -d --name "$CONTAINER" -p "${SHADOW_PORT}:5432" \
  -e POSTGRES_DB=luke -e POSTGRES_USER=luke -e POSTGRES_PASSWORD=luke \
  postgres:16-alpine >/dev/null

until docker exec "$CONTAINER" pg_isready -U luke -d luke >/dev/null 2>&1; do sleep 1; done

echo "📝 Generating migration \"${NAME}\"…"
npx prisma migrate dev --name "$NAME" --url "$SHADOW_URL"

cleanup
trap - EXIT

# The development DB is aligned with `db push`, not `migrate deploy`: its history in
# `_prisma_migrations` does not reflect the versioned migrations (see the troubleshooting section
# in docs/prisma-migration-workflow.md). `.env` has to be loaded by hand — Prisma 7 no longer does.
#
# The `.env` is `apps/api`'s: `DATABASE_URL` is infrastructure bootstrap for the
# deployment (Env Policy in CLAUDE.md), not a configuration file of this
# package. There is one database, so one place where it is declared.
echo "🚀 Applying the schema to the development database…"
set -a && . ../../apps/api/.env && set +a
npx prisma db push

echo "✅ Done. Commit the file in prisma/migrations/ together with the modified .prisma file(s)."
