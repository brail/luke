#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Luke — Refresh RC database from production
#
# Clones the current production DB into the RC stack (docker-compose.rc.yml)
# so RC mirrors prod before testing a release candidate. DESTRUCTIVE for RC:
# it wipes whatever is currently in the RC database and replaces it with a
# fresh copy of prod.
#
# Requires: both stacks (prod + RC) running on THIS docker host/daemon
# (same assumption as the "stack parallelo alla produzione" note in
# docker-compose.rc.yml). Containers are discovered via compose service
# labels, not container names, so it works regardless of the Portainer
# stack name.
#
# What it does:
#   1. Drops and recreates RC's 'public' schema (pg_restore --clean doesn't
#      order DROPs by FK dependency across tables and leaves a half-migrated
#      DB behind on failure — a clean schema sidesteps that entirely).
#   2. Streams pg_dump (prod) -> pg_restore (RC) in a single transaction, no
#      dump file ever touches disk (prod DB contains real user data).
#   3. Copies prod's master key (~/.luke/secret.key) into the RC api
#      container, so AppConfig secrets (SMTP/LDAP/NAV passwords) encrypted
#      under prod's key can still be decrypted in RC.
#   4. Restarts api-rc so Prisma applies pending migrations against the
#      freshly restored schema and picks up the new master key.
#
# NOT handled (by design): SMTP is left pointing at whatever RC's AppConfig
# already had (now overwritten with prod's config) — RC WILL be able to send
# real email to real users if something in the app triggers it. MinIO
# binaries (photos, attachments) are not cloned — file references in the UI
# will 404 in RC, expected.
#
# Usage: ./scripts/refresh-rc-db.sh [--yes]
#   --yes   skip the interactive confirmation prompt (for cron use)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SKIP_CONFIRM=false
if [[ "${1:-}" == "--yes" ]]; then
  SKIP_CONFIRM=true
fi

find_container() {
  local service="$1"
  docker ps --filter "label=com.docker.compose.service=${service}" --format '{{.Names}}' | head -1
}

PROD_PG=$(find_container "postgres")
PROD_API=$(find_container "api")
RC_PG=$(find_container "postgres-rc")
RC_API=$(find_container "api-rc")

for pair in "PROD_PG:postgres (prod)" "PROD_API:api (prod)" "RC_PG:postgres-rc (RC)" "RC_API:api-rc (RC)"; do
  var="${pair%%:*}"
  label="${pair#*:}"
  if [[ -z "${!var}" ]]; then
    echo "ERROR: container for service '${label}' not found/running on this docker host." >&2
    exit 1
  fi
done

echo "prod postgres : ${PROD_PG}"
echo "prod api      : ${PROD_API}"
echo "RC postgres   : ${RC_PG}"
echo "RC api        : ${RC_API}"
echo

if [[ "${SKIP_CONFIRM}" != true ]]; then
  read -r -p "This OVERWRITES the RC database with a copy of PRODUCTION data. Continue? [y/N] " reply
  if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Stopping api-rc (releases DB connections, avoids stale master key after copy)"
docker stop "${RC_API}" >/dev/null

echo "==> Terminating any remaining connections to RC 'luke' database"
docker exec "${RC_PG}" psql -U luke -d luke -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'luke' AND pid <> pg_backend_pid();" >/dev/null

echo "==> Dropping and recreating RC 'public' schema (pg_restore --clean doesn't order DROPs by FK dependency)"
docker exec "${RC_PG}" psql -U luke -d luke -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

echo "==> Streaming pg_dump (prod) -> pg_restore (RC), single transaction, no dump file written to disk"
docker exec "${PROD_PG}" pg_dump -U luke -d luke -F custom \
  | docker exec -i "${RC_PG}" pg_restore -U luke -d luke --no-owner --single-transaction

echo "==> Copying prod master key into RC api container (so encrypted AppConfig values decrypt)"
KEY_TMP=$(mktemp -d)
trap 'rm -rf "${KEY_TMP}"' EXIT
docker cp "${PROD_API}:/root/.luke/secret.key" "${KEY_TMP}/secret.key"
chmod 600 "${KEY_TMP}/secret.key"
docker cp "${KEY_TMP}/secret.key" "${RC_API}:/root/.luke/secret.key"

echo "==> Starting api-rc (applies pending Prisma migrations on boot)"
docker start "${RC_API}" >/dev/null

echo "==> Tailing api-rc logs for 15s to catch migration failures..."
timeout 15 docker logs -f "${RC_API}" || true

echo
echo "Done. Verify above that migrations applied cleanly (no 'prisma migrate deploy' errors)."
echo "Reminder: SMTP in RC now points at prod's mail config — real emails can go out to real users."
