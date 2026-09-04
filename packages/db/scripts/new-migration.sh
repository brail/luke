#!/usr/bin/env bash
#
# new-migration.sh — genera una migration versionata e la applica al database di sviluppo.
#
# Perché uno script e non quattro comandi in un .md: la procedura richiede un Postgres usa-e-getta
# (il DB di sviluppo è stato allineato con `db push`, quindi `migrate dev` lo vedrebbe in drift e
# proporrebbe di resettarlo), e i comandi giusti sono cambiati con Prisma 7 — `--skip-seed` non
# esiste più, e il CLI non carica più `.env` da solo. Una procedura scritta a mano marcisce; questa
# fallisce rumorosamente se qualcosa non torna.
#
# Uso:
#   pnpm --filter @luke/db db:migrate:new <nome_descrittivo>
#
# Al termine il file in prisma/migrations/ va committato insieme alle modifiche ai file .prisma.

set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "❌ Manca il nome della migration. Uso: pnpm --filter @luke/db db:migrate:new <nome_descrittivo>" >&2
  exit 1
fi

CONTAINER="luke-pg-migrate"
SHADOW_PORT=5433
SHADOW_URL="postgresql://luke:luke@localhost:${SHADOW_PORT}/luke"

# `--rm` da solo non basta: se lo script muore fra `docker run` e `docker stop`, il container resta
# su e la porta occupata fa fallire la run successiva con un errore che non nomina il container.
cleanup() {
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "🐘 Postgres temporaneo sulla porta ${SHADOW_PORT}…"
docker run --rm -d --name "$CONTAINER" -p "${SHADOW_PORT}:5432" \
  -e POSTGRES_DB=luke -e POSTGRES_USER=luke -e POSTGRES_PASSWORD=luke \
  postgres:16-alpine >/dev/null

until docker exec "$CONTAINER" pg_isready -U luke -d luke >/dev/null 2>&1; do sleep 1; done

echo "📝 Genero la migration \"${NAME}\"…"
npx prisma migrate dev --name "$NAME" --url "$SHADOW_URL"

cleanup
trap - EXIT

# Il DB di sviluppo si allinea con `db push`, non con `migrate deploy`: il suo storico in
# `_prisma_migrations` non riflette le migration versionate (vedi la sezione troubleshooting in
# docs/prisma-migration-workflow.md). `.env` va caricata a mano — Prisma 7 non lo fa più.
#
# La `.env` è quella di `apps/api`: `DATABASE_URL` è bootstrap infrastrutturale del
# deployment (Env Policy in CLAUDE.md), non un file di configurazione di questo
# package. C'è un solo database, quindi un solo posto dove è dichiarato.
echo "🚀 Applico lo schema al database di sviluppo…"
set -a && . ../../apps/api/.env && set +a
npx prisma db push

echo "✅ Fatto. Committa il file in prisma/migrations/ insieme al/i file .prisma modificato/i."
