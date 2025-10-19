# Report File Inutili — Cleanup Analysis

**Data**: $(date)  
**Progetto**: @luke/monorepo  
**Tool**: Pattern-based analysis (grep/find)  
**Status**: ✅ DRY-RUN COMPLETATO

## 📊 Riepilogo

| Categoria                  | File Trovati | Dimensione Stimata | Rischio      |
| -------------------------- | ------------ | ------------------ | ------------ |
| File `.backup`             | 2            | ~2KB               | 🟢 Basso     |
| Build artifacts in `src/`  | 22           | ~15KB              | 🟡 Medio     |
| Build info non ignorato    | 1            | ~1KB               | 🟢 Basso     |
| Directory `/src` duplicata | 8            | ~25KB              | 🟢 Basso     |
| Backup database Prisma     | 3            | ~320KB             | 🟢 Basso     |
| **TOTALE**                 | **36**       | **~363KB**         | **🟡 Medio** |

## 🔍 Analisi Dettagliata

### 1. File `.backup` (2 file) - ✅ SICURI DA RIMUOVERE

| Path                                            | Ultimo Commit | Motivo                            | Azione     |
| ----------------------------------------------- | ------------- | --------------------------------- | ---------- |
| `apps/web/src/components/UserDialog.tsx.backup` | 22ff13f       | File di sviluppo mai referenziati | **REMOVE** |
| `apps/web/src/components/UserForm.tsx.backup`   | 22ff13f       | File di sviluppo mai referenziati | **REMOVE** |

**Evidenza**: Versioni attive esistono (`UserDialog.tsx`, `UserForm.tsx`), nessun import trovato.

### 2. Build Artifacts in `src/` (22 file) - ⚠️ ATTENZIONE

| Path                                       | Ultimo Commit | Motivo                              | Azione     |
| ------------------------------------------ | ------------- | ----------------------------------- | ---------- |
| `apps/api/src/lib/*.d.ts` (6 file)         | 8d88028       | Generati da compilazione errata     | **REMOVE** |
| `apps/api/src/lib/*.d.ts.map` (6 file)     | 8d88028       | Source maps in src/ invece di dist/ | **REMOVE** |
| `apps/api/src/routers/*.d.ts.map` (5 file) | 8d88028       | Source maps in src/ invece di dist/ | **REMOVE** |
| `apps/api/src/routers/*.js.map` (5 file)   | 8d88028       | Source maps in src/ invece di dist/ | **REMOVE** |

**Evidenza**: `tsconfig.json` ha `outDir: "./dist"` ma qualcuno ha eseguito `tsc` nella root sbagliata.

### 3. Build Info Non Ignorato (1 file) - ✅ SICURI DA RIMUOVERE

| Path                            | Ultimo Commit | Motivo                       | Azione     |
| ------------------------------- | ------------- | ---------------------------- | ---------- |
| `apps/api/tsconfig.tsbuildinfo` | 8d88028       | File incrementale TypeScript | **REMOVE** |

**Evidenza**: File di build incrementale che deve essere ignorato.

### 4. Directory `/src` Duplicata (8 file) - ✅ SICURI DA RIMUOVERE

| Path                                 | Ultimo Commit | Motivo                         | Azione     |
| ------------------------------------ | ------------- | ------------------------------ | ---------- |
| `src/components/ui/alert-dialog.tsx` | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/alert.tsx`        | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/breadcrumb.tsx`   | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/button.tsx`       | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/form.tsx`         | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/input.tsx`        | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/label.tsx`        | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/components/ui/switch.tsx`       | cdd515d       | Componente shadcn duplicato    | **REMOVE** |
| `src/hooks/` (directory vuota)       | N/A           | Directory vuota mai utilizzata | **REMOVE** |

**Evidenza**: Le app usano `apps/web/src/components/ui/*`, nessun import da `/src` trovato.

### 5. Backup Database Prisma (3 file) - ✅ SICURI DA RIMUOVERE

| Path                                              | Ultimo Commit | Motivo                            | Azione     |
| ------------------------------------------------- | ------------- | --------------------------------- | ---------- |
| `apps/api/prisma/dev.db.backup.2025-10-19_21-37-` | N/A           | Backup database già in .gitignore | **REMOVE** |
| `apps/api/prisma/dev.db.backup.20251016_152041`   | N/A           | Backup database già in .gitignore | **REMOVE** |
| `apps/api/prisma/dev.db.backup.20251019_211712`   | N/A           | Backup database già in .gitignore | **REMOVE** |

**Evidenza**: Pattern già presente in `.gitignore` ma file ancora tracciati.

## 🛡️ Guard-Rail Applicati

✅ **File PROTETTI** (non toccati):

- `prisma/migrations/` - Migrazioni database
- `schema.prisma` - Schema Prisma
- `package.json` - Configurazioni package
- `tsconfig*.json` - Configurazioni TypeScript
- `README*`, `LICENSE*` - Documentazione
- `**/test/**` - File di test

## 📋 Comandi Git per Rimozione

### Backup Files (2 file)

```bash
git rm apps/web/src/components/UserDialog.tsx.backup
git rm apps/web/src/components/UserForm.tsx.backup
```

### Build Artifacts in src/ (22 file)

```bash
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
```

### Build Info (1 file)

```bash
git rm apps/api/tsconfig.tsbuildinfo
```

### Directory /src Duplicata (8 file + 1 directory)

```bash
# Componenti UI duplicati
git rm src/components/ui/alert-dialog.tsx
git rm src/components/ui/alert.tsx
git rm src/components/ui/breadcrumb.tsx
git rm src/components/ui/button.tsx
git rm src/components/ui/form.tsx
git rm src/components/ui/input.tsx
git rm src/components/ui/label.tsx
git rm src/components/ui/switch.tsx

# Directory hooks vuota
git rm -r src/hooks/
```

### Backup Database Prisma (3 file)

```bash
git rm apps/api/prisma/dev.db.backup.2025-10-19_21-37-
git rm apps/api/prisma/dev.db.backup.20251016_152041
git rm apps/api/prisma/dev.db.backup.20251019_211712
```

## 🧪 Validazione Post-Cleanup

Dopo la rimozione, eseguire:

```bash
# 1. Verifica build
pnpm -w lint && pnpm -w typecheck && pnpm -w build

# 2. Test API
pnpm -F @luke/api test

# 3. Verifica git status
git status --short

# 4. Commit finale
git add .
git commit -m "chore(cleanup): remove unused files (safe) — 36 files

- Remove .backup files (2)
- Remove build artifacts from src/ (22)
- Remove tsbuildinfo (1)
- Remove duplicated /src components (8)
- Remove Prisma backup files (3)

Total: 36 files, ~363KB freed"
```

## ⚠️ Note Importanti

1. **Build Artifacts**: I file `.d.ts` e `.map` in `src/` sono stati generati erroneamente. Il `tsconfig.json` ha `outDir: "./dist"` ma qualcuno ha eseguito `tsc` nella root sbagliata.

2. **Directory /src**: Contiene componenti shadcn duplicati mai utilizzati. Le app usano `apps/web/src/components/ui/*`.

3. **Backup Files**: File di sviluppo temporanei mai referenziati.

4. **Prisma Backups**: Già in `.gitignore` ma ancora tracciati da git.

## ✅ Raccomandazione

**PROCEDI CON LA RIMOZIONE** - Tutti i file sono sicuri da rimuovere:

- ✅ Nessun file critico toccato
- ✅ Build artifacts in posizione sbagliata
- ✅ Duplicati mai utilizzati
- ✅ File temporanei di sviluppo
- ✅ Pattern già in `.gitignore`

**Rischio**: 🟡 Medio (solo per build artifacts, ma sono in posizione sbagliata)
