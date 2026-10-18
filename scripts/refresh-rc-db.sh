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
# (same assumption as the "parallel to production" note in
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
#   3. Deletes the restored AppConfig rows through which RC could reach real
#      systems, before api-rc can read them (the SQL below says why per key).
#   4. Restarts api-rc so Prisma applies pending migrations against the
#      freshly restored schema.
#
# Prod's master key (~/.luke/secret.key) is NOT copied: it derives every
# other secret and decrypts every encrypted AppConfig row (ADR-020), so a copy
# would make compromising RC compromising prod. RC keeps its own key, and
# prod's encrypted rows do not decrypt there. An RC refreshed by an earlier
# version of this script may still hold prod's key: see docs/rc-prod-clone.md.
#
# NOT handled (by design): S3 storage binaries (photos, attachments) are not
# cloned — file references in the UI will 404 in RC, expected.
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
RC_PG=$(find_container "postgres-rc")
RC_API=$(find_container "api-rc")

for pair in "PROD_PG:postgres (prod)" "RC_PG:postgres-rc (RC)" "RC_API:api-rc (RC)"; do
  var="${pair%%:*}"
  label="${pair#*:}"
  if [[ -z "${!var}" ]]; then
    echo "ERROR: container for service '${label}' not found/running on this docker host." >&2
    exit 1
  fi
done

echo "prod postgres : ${PROD_PG}"
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

echo "==> Stopping api-rc (releases DB connections; stays stopped until the config is neutralized)"
docker stop "${RC_API}" >/dev/null

echo "==> Terminating any remaining connections to RC 'luke' database"
docker exec "${RC_PG}" psql -U luke -d luke -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'luke' AND pid <> pg_backend_pid();" >/dev/null

echo "==> Dropping and recreating RC 'public' schema (pg_restore --clean doesn't order DROPs by FK dependency)"
docker exec "${RC_PG}" psql -U luke -d luke -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

echo "==> Streaming pg_dump (prod) -> pg_restore (RC), single transaction, no dump file written to disk"
docker exec "${PROD_PG}" pg_dump -U luke -d luke -F custom \
  | docker exec -i "${RC_PG}" pg_restore -U luke -d luke --no-owner --single-transaction

echo "==> Neutralizing outbound integrations in RC's AppConfig"
# One statement: it applies whole or not at all. Prod's encrypted rows already fail to
# decrypt on RC; these rows go because a missing row is a clean "not configured", or
# because the value may be plaintext:
#   smtp.%                 RC's users are real people with real addresses
#   integrations.github.%  the feedback token has no dedicated form, may be plaintext
#   storage.s3.%           the provider refuses until RC's own values are saved
#   integrations.nav.host  gate of every NAV scheduler and of the live NAV queries
#   auth.ldap.enabled      absent = off: no bind or anonymous search against prod's
#                          directory, even if its URL was saved in plaintext
#   ...calendarSync.enabled  defaults to 'false'
#   app.baseUrl            builds email links only; the API refuses to delete it,
#                          harmless here (defaults to localhost)
#   plaintext credentials  the generic config API stores with encryption off by
#                          default (also drops a plaintext auth.nextAuthSecret, read
#                          only by the seed)
# storage.type and storage.minio.* (2.1.6's form encrypts the keys) stay as prod has
# them: rehearsing the 2.1.6 -> 3.0 upgrade on RC starts from prod's storage state.
if ! NEUTRALIZED=$(docker exec -i "${RC_PG}" psql -U luke -d luke -v ON_ERROR_STOP=1 -q -At -f - <<'SQL'
DELETE FROM app_configs
WHERE key LIKE 'smtp.%' OR key LIKE 'integrations.github.%' OR key LIKE 'storage.s3.%'
   OR key IN ('app.baseUrl', 'auth.ldap.enabled', 'integrations.nav.host',
              'integrations.google.calendarSync.enabled')
   OR (NOT "isEncrypted" AND key ~* '(pass|password|secret|token|key)$')
RETURNING '  - ' || key;
SQL
); then
  echo "ERROR: RC database NOT neutralized — do not start api-rc, it holds prod's configuration." >&2
  exit 1
fi
echo "Removed:"
echo "${NEUTRALIZED:-  (none)}"

echo "==> Starting api-rc (applies pending Prisma migrations on boot)"
docker start "${RC_API}" >/dev/null

echo "==> Tailing api-rc logs for 15s to catch migration failures..."
timeout 15 docker logs -f "${RC_API}" || true

echo
echo "Done. Verify above that migrations applied cleanly (no 'prisma migrate deploy' errors)."
echo "RC keeps its own master key: prod's encrypted settings do not decrypt here. LDAP is"
echo "off until it is saved again — sign in with a local administrator. Set by hand"
echo "only what the test needs: S3 in Impostazioni → Storage, LDAP, NAV, Google; SMTP only"
echo "towards a test sink — RC's users are real people with real addresses."
