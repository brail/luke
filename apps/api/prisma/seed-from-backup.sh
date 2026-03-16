#!/usr/bin/env bash
# seed-from-backup.sh
# Popola il database corrente con i dati dal backup.
# Copia tutte le tabelle condivise; salta _prisma_migrations e le tabelle nuove
# (collection_layouts, collection_groups, collection_layout_rows).
#
# Uso:
#   ./seed-from-backup.sh [percorso-backup]
#
# Se non specificato, usa il backup più recente trovato nella stessa cartella.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEW_DB="$SCRIPT_DIR/dev.db"

# ─── Individua il backup ──────────────────────────────────────────
if [[ $# -ge 1 ]]; then
  BACKUP_DB="$1"
else
  BACKUP_DB=$(ls -t "$SCRIPT_DIR"/dev.db.backup-* 2>/dev/null | head -1 || true)
fi

# ─── Controlli preliminari ───────────────────────────────────────
if [[ -z "$BACKUP_DB" ]]; then
  echo "❌ Nessun file di backup trovato in $SCRIPT_DIR"
  echo "   Usa: $0 /percorso/al/backup.db"
  exit 1
fi

if [[ ! -f "$BACKUP_DB" ]]; then
  echo "❌ Backup non trovato: $BACKUP_DB"
  exit 1
fi

if [[ ! -f "$NEW_DB" ]]; then
  echo "❌ Database target non trovato: $NEW_DB"
  exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
  echo "❌ sqlite3 non trovato. Installalo prima di continuare."
  exit 1
fi

echo "📦 Backup:  $BACKUP_DB"
echo "🗄️  Target:  $NEW_DB"
echo ""

# ─── Mostra conteggi nel backup ──────────────────────────────────
echo "Righe nel backup:"
for t in users brands seasons app_configs pricing_parameter_sets \
          file_objects local_credentials identities user_tokens \
          user_preferences user_granted_permissions user_section_access \
          audit_logs permission_audits; do
  count=$(sqlite3 "$BACKUP_DB" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo "N/A")
  printf "  %-35s %s\n" "$t" "$count"
done
echo ""

# ─── Conferma ────────────────────────────────────────────────────
read -rp "⚠️  Continuare? Tutte le righe nelle tabelle sopra verranno SOSTITUITE nel db corrente. [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Annullato."
  exit 0
fi
echo ""

# ─── Tabelle da copiare (in ordine FK-safe) ──────────────────────
TABLES=(
  users
  brands
  seasons
  app_configs
  identities
  local_credentials
  user_tokens
  user_preferences
  user_section_access
  user_granted_permissions
  pricing_parameter_sets
  file_objects
  audit_logs
  permission_audits
)

# ─── Esegui la copia via ATTACH ──────────────────────────────────
echo "🚀 Avvio copia..."

SQL=""
SQL+="ATTACH DATABASE '$BACKUP_DB' AS backup;"$'\n'
SQL+="PRAGMA main.foreign_keys = OFF;"$'\n'
SQL+="PRAGMA main.journal_mode = WAL;"$'\n'
SQL+="BEGIN TRANSACTION;"$'\n'

for t in "${TABLES[@]}"; do
  SQL+="DELETE FROM main.\"$t\";"$'\n'
  SQL+="INSERT INTO main.\"$t\" SELECT * FROM backup.\"$t\";"$'\n'
done

SQL+="COMMIT;"$'\n'
SQL+="PRAGMA main.foreign_keys = ON;"$'\n'
SQL+="DETACH DATABASE backup;"$'\n'

sqlite3 "$NEW_DB" "$SQL"

# ─── Verifica conteggi ───────────────────────────────────────────
echo ""
echo "✅ Copia completata. Verifica:"
for t in "${TABLES[@]}"; do
  old=$(sqlite3 "$BACKUP_DB" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo "?")
  new=$(sqlite3 "$NEW_DB"    "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo "?")
  if [[ "$old" == "$new" ]]; then
    printf "  ✓ %-35s %s\n" "$t" "$new"
  else
    printf "  ✗ %-35s backup=%s  new=%s  ← MISMATCH\n" "$t" "$old" "$new"
  fi
done

echo ""
echo "🎉 Seed completato."
