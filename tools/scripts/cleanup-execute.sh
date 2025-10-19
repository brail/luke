#!/bin/bash
# Script per eseguire la rimozione sicura dei file inutili
# Eseguire solo dopo aver verificato il report: tools/reports/unused-files.report.md

set -e

echo "🧹 Cleanup File Inutili - Esecuzione Sicura"
echo "============================================="
echo ""

# Verifica che siamo nella root del progetto
if [ ! -f "package.json" ] || [ ! -f "turbo.json" ]; then
    echo "❌ Errore: Eseguire dalla root del progetto"
    exit 1
fi

echo "📋 Verifica pre-rimozione..."
echo ""

# Backup dello stato git attuale
echo "💾 Creazione backup dello stato git..."
git stash push -m "backup-pre-cleanup-$(date +%Y%m%d-%H%M%S)" || true

echo "🗑️  Rimozione file inutili..."
echo ""

# 1. File .backup (2 file)
echo "1️⃣ Rimozione file .backup..."
git rm apps/web/src/components/UserDialog.tsx.backup
git rm apps/web/src/components/UserForm.tsx.backup

# 2. Build artifacts in src/ (22 file)
echo "2️⃣ Rimozione build artifacts da src/..."
# Declaration files
git rm apps/api/src/lib/auditLog.d.ts
git rm apps/api/src/lib/auth.d.ts
git rm apps/api/src/lib/configManager.d.ts
git rm apps/api/src/lib/errorHandler.d.ts
git rm apps/api/src/lib/ldapAuth.d.ts
git rm apps/api/src/lib/trpc.d.ts

# Source maps
git rm apps/api/src/lib/auditLog.d.ts.map
git rm apps/api/src/lib/auth.d.ts.map
git rm apps/api/src/lib/configManager.d.ts.map
git rm apps/api/src/lib/errorHandler.d.ts.map
git rm apps/api/src/lib/ldapAuth.d.ts.map
git rm apps/api/src/lib/trpc.d.ts.map
git rm apps/api/src/routers/auth.d.ts.map
git rm apps/api/src/routers/auth.js.map
git rm apps/api/src/routers/config.d.ts.map
git rm apps/api/src/routers/config.js.map
git rm apps/api/src/routers/index.d.ts.map
git rm apps/api/src/routers/index.js.map
git rm apps/api/src/routers/integrations.d.ts.map
git rm apps/api/src/routers/integrations.js.map
git rm apps/api/src/routers/users.d.ts.map
git rm apps/api/src/routers/users.js.map

# 3. Build info (1 file)
echo "3️⃣ Rimozione tsbuildinfo..."
git rm apps/api/tsconfig.tsbuildinfo

# 4. Directory /src duplicata (8 file + 1 directory)
echo "4️⃣ Rimozione componenti duplicati da /src..."
git rm src/components/ui/alert-dialog.tsx
git rm src/components/ui/alert.tsx
git rm src/components/ui/breadcrumb.tsx
git rm src/components/ui/button.tsx
git rm src/components/ui/form.tsx
git rm src/components/ui/input.tsx
git rm src/components/ui/label.tsx
git rm src/components/ui/switch.tsx
git rm -r src/hooks/

# 5. Backup database Prisma (3 file)
echo "5️⃣ Rimozione backup database Prisma..."
git rm apps/api/prisma/dev.db.backup.2025-10-19_21-37-
git rm apps/api/prisma/dev.db.backup.20251016_152041
git rm apps/api/prisma/dev.db.backup.20251019_211712

echo ""
echo "✅ Rimozione completata!"
echo ""

# Mostra lo stato git
echo "📊 Stato git dopo rimozione:"
git status --short

echo ""
echo "🧪 Esecuzione validazione..."
echo ""

# Validazione build
echo "1️⃣ Lint e typecheck..."
pnpm -w lint
pnpm -w typecheck

echo "2️⃣ Build..."
pnpm -w build

echo "3️⃣ Test API..."
pnpm -F @luke/api test

echo ""
echo "🎉 Cleanup completato con successo!"
echo ""
echo "📝 Per committare le modifiche:"
echo "git add ."
echo "git commit -m \"chore(cleanup): remove unused files (safe) — 36 files\""
echo ""
echo "🔄 Per ripristinare se necessario:"
echo "git stash pop"
