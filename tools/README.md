# Tools Directory

Strumenti di manutenzione del monorepo.

## 📁 Struttura

```
tools/
├── codemods/
│   └── eliminate-hardcoded-urls.ts  # Codemod ts-morph, supporta --dry-run
├── reports/                         # Output storici degli script
├── scripts/
│   ├── check-docs-integrity.ts      # Link e marker luke-docs nei .md tracciati
│   ├── check-skill-integrity.ts     # Path e simboli citati da .claude/skills/
│   └── lib/                         # Regole condivise fra gli script
└── README.md                        # Questo file
```

## 🔍 Controlli di drift

`check-docs-integrity` e `check-skill-integrity` girano in CI dietro
`pnpm check:drift` e sono bloccanti. Entrambi derivano il proprio insieme di file
da git, non da liste scritte a mano: il perché sta in `scripts/lib/gitPaths.ts`.

```bash
pnpm check:drift
```

## 🧹 Cleanup file inutili

Rimosso. Era uno script one-shot dell'ottobre 2025 con 36 path scritti a mano,
tutti già cancellati da tempo: con `set -e` abortiva sul primo `git rm`, dopo
aver però già eseguito `git stash push` sul lavoro in corso. Le cinque categorie
che puliva (`.backup`, `.d.ts`/`.map` sotto `src/`, `tsbuildinfo`, `/src`
duplicata, `dev.db.backup.*`) sono oggi coperte da `.gitignore`.

Anche gli import non utilizzati non hanno più uno script dedicato:
`@typescript-eslint/no-unused-vars` è già `error` in `eslint.config.mjs`, e
`eslint --fix` li rimuove lavorando sull'AST invece che per sostituzione di
stringhe sulla riga di import.
