# Tools Directory

Questa directory contiene strumenti e configurazioni per la manutenzione del monorepo.

## 📁 Struttura

```
tools/
├── config/
│   └── cleanup.blocklist.json    # File protetti durante cleanup
├── reports/
│   └── unused-files.report.md    # Report file inutili
├── scripts/
│   └── cleanup-execute.sh        # Script di esecuzione cleanup
└── README.md                     # Questo file
```

## 🧹 Cleanup File Inutili

### Report Generato

- **File**: `reports/unused-files.report.md`
- **Status**: ✅ DRY-RUN COMPLETATO
- **File trovati**: 36 file (~363KB)
- **Rischio**: 🟡 Medio (solo build artifacts in posizione sbagliata)

### Categorie File

1. **File `.backup`** (2 file) - File di sviluppo temporanei
2. **Build artifacts in `src/`** (22 file) - Generati erroneamente in src/ invece di dist/
3. **Build info non ignorato** (1 file) - tsbuildinfo tracciato da git
4. **Directory `/src` duplicata** (8 file) - Componenti shadcn duplicati mai utilizzati
5. **Backup database Prisma** (3 file) - Già in .gitignore ma ancora tracciati

### Esecuzione

**Opzione 1: Script automatico (raccomandato)**

```bash
./tools/scripts/cleanup-execute.sh
```

**Opzione 2: Comandi manuali**
Vedi `reports/unused-files.report.md` per i comandi `git rm` specifici.

### Validazione Post-Cleanup

```bash
pnpm -w lint && pnpm -w typecheck && pnpm -w build
pnpm -F @luke/api test
```

## 🛡️ Sicurezza

- **Blocklist**: `config/cleanup.blocklist.json` protegge file critici
- **Gitignore aggiornato**: Pattern per evitare futuri problemi
- **Backup automatico**: Script crea stash prima dell'esecuzione

## 📋 Guard-Rail

File **MAI** rimossi:

- `prisma/migrations/`, `schema.prisma`
- `package.json`, `tsconfig*.json`
- `README*`, `LICENSE*`
- File di test e configurazione
