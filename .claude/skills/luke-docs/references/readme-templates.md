# luke-docs — Template README (modalità `readme`)

Ogni sezione generata vive tra marker `<!-- luke-docs:start:NAME -->` / `<!-- luke-docs:end:NAME -->`.
Contenuto fuori dai marker = manuale, mai toccarlo.

## Logica update (run successive)

| Situazione                          | Comportamento                                 |
| ----------------------------------- | --------------------------------------------- |
| README non esiste                   | Scrivi tutto da zero con tutti i marker       |
| README esiste, sezione ha marker    | Sostituisci il contenuto tra i marker         |
| README esiste, sezione senza marker | **Non toccare** — è stata scritta manualmente |
| Marker presente ma contenuto vuoto  | Genera il contenuto                           |

---

## `/README.md` (root)

```markdown
# Luke

<!-- luke-docs:start:overview -->

{1-2 paragrafi: cos'è Luke, chi lo usa, problema che risolve — FEBOS/BLAUER, B2B interno,
collection management, season planning, sourcing, merchandise planning.
Menziona ISO 9001 e integrazione NAV se rilevante.}

<!-- luke-docs:end:overview -->

## Struttura del monorepo

<!-- luke-docs:start:structure -->

{Tabella: Workspace | Tipo | Descrizione — genera da dizionario Phase 1}

<!-- luke-docs:end:structure -->

## Prerequisiti

<!-- luke-docs:start:prerequisites -->

{Versioni da package.json engines + runtime richiesti: Node.js, pnpm, Docker, PostgreSQL, MinIO, MSSQL per NAV sync}

<!-- luke-docs:end:prerequisites -->

## Quick Start

<!-- luke-docs:start:quickstart -->

{Blocco bash: clone, pnpm install, cp .env.example .env, pnpm dev}

<!-- luke-docs:end:quickstart -->

## Script disponibili

<!-- luke-docs:start:scripts -->

{Tabella degli script root-level rilevanti: dev, build, lint, typecheck, test, db:migrate}

<!-- luke-docs:end:scripts -->

## Deployment

<!-- luke-docs:start:deployment -->

{3-4 frasi: conventional tag → GitHub Actions → ghcr.io → Portainer.
Non inventare dettagli che non riesci a verificare dalla codebase.}

<!-- luke-docs:end:deployment -->

## Architettura

<!-- luke-docs:start:architecture -->

{Paragrafo breve: stack, pattern principali (tRPC end-to-end types, RBAC, NAV sync).
Link a docs/decisions/ per le decisioni architetturali.}

<!-- luke-docs:end:architecture -->

## Decisioni architetturali

<!-- luke-docs:start:adr-link -->

Le decisioni architetturali rilevanti sono documentate in [`docs/decisions/`](docs/decisions/README.md).

<!-- luke-docs:end:adr-link -->

## Release

<!-- luke-docs:start:release -->

{Conventional commits + git-cliff per CHANGELOG automatico.
Tag naming: vX.Y.Z. commitlint + husky hooks attivi.}

<!-- luke-docs:end:release -->
```

---

## `apps/web/README.md`

```markdown
# apps/web — Frontend Luke

<!-- luke-docs:start:overview -->

{Next.js 15, App Router, shadcn/ui. Cosa renderizza, chi lo usa.}

<!-- luke-docs:end:overview -->

## Route principali

<!-- luke-docs:start:routes -->

{Albero delle directory `src/app/` a 2 livelli con una riga descrittiva per ciascuna.
Usa indentazione markdown, non tabella.}

<!-- luke-docs:end:routes -->

## Dipendenze interne

<!-- luke-docs:start:internal-deps -->

{Lista dei packages/ interni importati da questo app.}

<!-- luke-docs:end:internal-deps -->

## Variabili d'ambiente

<!-- luke-docs:start:env -->

{Tabella: Variabile | Descrizione | Richiesta. Solo quelle consumate da web.}

<!-- luke-docs:end:env -->

## Sviluppo locale

<!-- luke-docs:start:dev -->

{Comando per avviare in dev dal root del monorepo e dalla dir dell'app.}

<!-- luke-docs:end:dev -->
```

---

## `apps/api/README.md`

```markdown
# apps/api — Backend Luke

<!-- luke-docs:start:overview -->

{Fastify 5 + tRPC + Prisma + PostgreSQL. Cosa espone (tRPC endpoint, eventuale REST).}

<!-- luke-docs:end:overview -->

## Router tRPC

<!-- luke-docs:start:trpc-routers -->

{Lista dei namespace router (da elenco file in `src/routers/`).
Formato: `namespace.*` — descrizione breve}

<!-- luke-docs:end:trpc-routers -->

## Packages interni utilizzati

<!-- luke-docs:start:internal-deps -->

{Lista packages/ importati.}

<!-- luke-docs:end:internal-deps -->

## Variabili d'ambiente

<!-- luke-docs:start:env -->

{Tabella: Variabile | Tipo | Default | Descrizione.
Fonti: `.env.production.example` + policy env in CLAUDE.md.
Menziona `assertEnvPolicy()` in `apps/api/src/server.ts` (enforcement in produzione).}

<!-- luke-docs:end:env -->

## Database

<!-- luke-docs:start:database -->

{PostgreSQL + Prisma. Comandi migrate + studio. Elenco model rilevati in Phase 1.}

<!-- luke-docs:end:database -->

## NAV Sync

<!-- luke-docs:start:nav -->

{packages/nav, MSSQL diretto (no DAB), sync unidirezionale NAV → Luke.
Config NAV letta da AppConfig, non da env.}

<!-- luke-docs:end:nav -->

## Storage

<!-- luke-docs:start:storage -->

{Provider IStorageProvider. Bucket validi: leggi `isValidBucket()` in
`packages/core/src/storage/config.ts` — non hardcodare l'elenco.
Content-addressed SHA256 key per foto revisioni.}

<!-- luke-docs:end:storage -->
```

---

## `packages/*/README.md` (uno per package)

```markdown
# @luke/{name}

<!-- luke-docs:start:overview -->

{1 frase: cosa fa questo package, quale domain problem risolve.}

<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->

{Lista di apps/packages che importano da questo package — da dizionario Phase 1.}

<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->

{Tabella o lista: Simbolo | Tipo | Descrizione breve.
Solo export pubblici di `src/index.ts`. Max 20 righe — se ci sono troppi export, raggruppa per categoria.}

<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->

{3-6 bullet point su comportamenti non ovvi, pattern, vincoli architetturali del package.}

<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->

{Snippet TypeScript minimale che mostra l'uso più comune. Deve essere sintatticamente valido.}

<!-- luke-docs:end:example -->
```

---

## `docs/README.md` (indice documentazione)

```markdown
# Documentazione Luke

<!-- luke-docs:start:index -->

{Indice dei contenuti in docs/, con link e una riga descrittiva per ciascun file/directory.
Generato da elenco file rilevato in Phase 1.}

<!-- luke-docs:end:index -->
```

---

## Checklist qualità README (verifica prima di chiudere)

- [ ] Nessun testo placeholder (`TBD`, `…`, `{da compilare}`)
- [ ] Tutti i code snippet sono sintatticamente validi
- [ ] Tutti i link interni `[testo](#ancora)` risolvono a sezioni esistenti
- [ ] Il link root README → `docs/decisions/README.md` risolve
- [ ] Le env var listate corrispondono a `.env.production.example` reale
- [ ] L'elenco export corrisponde a ciò che `index.ts` esporta realmente
- [ ] Nessun numero di versione hardcoded (usa `package.json` come source of truth)
- [ ] Tabella "Struttura monorepo" nel root README include tutti i workspace
