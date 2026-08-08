---
name: luke-docs
description: >
  Documentation generator and maintainer for the Luke monorepo. Three modes:
  readme (creates/updates README.md at every level with luke-docs markers),
  inline (JSDoc on TypeScript exports, tRPC procedure comments, Prisma ///
  field docs), adr (validates docs/decisions/ ADRs against the codebase and
  maintains the index). Use when asked to generate, update, or normalize
  documentation. Modes: /luke-docs readme | inline | adr | (all in sequence).
  Supports --since <git-ref> and --dry-run.
argument-hint: '[readme|inline|adr] [--since <git-ref>] [--dry-run]'
context: fork
agent: general-purpose
---

# Luke Docs — Generatore e manutentore di documentazione

Tre modalità:

| Modalità | Cosa fa                                                                                          | Riferimento dettagli             |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------- |
| `readme` | Crea/aggiorna i `README.md` a ogni livello (root, `apps/*`, `packages/*`, `docs/`)               | `references/readme-templates.md` |
| `inline` | Normalizza i commenti nel sorgente: JSDoc su export TS, commenti tRPC, field docs Prisma (`///`) | `references/inline-rules.md`     |
| `adr`    | Valida gli ADR in `docs/decisions/` contro la codebase, aggiorna gli Status, mantiene l'indice   | `references/adr-rules.md`        |

Nessuna modalità in $ARGUMENTS → esegui `readme` → `inline` → `adr` in sequenza, report combinato.

**Prima di eseguire una modalità, leggi il suo file in `references/`** — contiene
template, logica di merge e checklist qualità obbligatorie.

**Leggi anche `.claude/skills/luke-shared/audit-protocol.md`** e applica le sezioni
che la sua tabella di applicabilità assegna a `/luke-docs`: §1 scoping e §7 sessioni
concorrenti — scrivi file, quindi §7.2 ti riguarda.

---

## Regole obbligatorie (precedono tutto il resto)

1. **Read before write** — mai generare contenuto per un file senza averlo letto prima.
2. **No SQL, no migrations, no test runner** — `schema.prisma` si legge come testo;
   mai `prisma migrate/generate`, `pnpm db:*`, `pnpm test`.
3. **Parallel agents: max 3** simultanei.
4. **Preserva i marker** — mai sovrascrivere contenuto fuori dai marker `luke-docs:start/end`.
   L'integrità dei marker e la risoluzione dei link interni **non** si verificano
   qui: le controlla `tools/scripts/check-docs-integrity.ts`, bloccante in CI.
   Sono parsing puro, e un parsing affidato a un LLM è un controllo di livello 4
   dove ne basta uno di livello 2.
5. **Dry-run** — con `--dry-run`, stampa il piano senza scrivere alcun file.
6. **No placeholder** — mai `TBD`, `TODO`, `…`, `{da compilare}` nel testo generato.
   Se manca informazione: ometti la sezione e segnalala nel report.
7. **Non toccare mai**: `.planning/`, `CLAUDE.md`, `lessons.md`.
8. **Report finale sempre** — file creati/aggiornati/invariati + simboli documentati + issue flaggate.
9. **Commit suggestion** al termine: `docs: update readme tree, inline comments and adr validation [luke-docs]`

## Lingua

| Contesto                                             | Lingua       |
| ---------------------------------------------------- | ------------ |
| Commenti inline (JSDoc, tRPC `/** */`, Prisma `///`) | **Inglese**  |
| README.md (tutti i livelli) e ADR                    | **Italiano** |

Nessuna eccezione per termini di dominio italiani (es. "stagione"→season,
"campionario"→collection/catalog, "reso"→return): tradurre sempre, anche nei
commenti inline. Vedi CLAUDE.md, sezione Development Patterns, regola 14.

---

## Flag `--since <git-ref>` (opzionale)

Limita il lavoro ai soli file modificati rispetto al ref. Prima di Phase 1:

```bash
git diff --name-only <git-ref> HEAD
```

- `inline`: processa solo i `.ts` / `.prisma` nel diff
- `readme`: rigenera il README di un workspace solo se almeno un suo file è nel diff,
  oppure se il README non esiste ancora
- `adr`: rivalida solo gli ADR le cui affermazioni referenziano file nel diff;
  rigenera sempre l'indice

Lista vuota → termina: `Nessun file rilevante modificato rispetto a <git-ref>. Nulla da fare.`

---

## Modalità `readme`

**Phase 1 — Explore (obbligatoria).** Leggi in ordine:

1. `package.json` root (workspaces, scripts, engines) + `turbo.json`
2. Per ogni workspace: `package.json`, `src/index.ts(x)`, `README.md` esistente
3. `.env.production.example` + policy env in `CLAUDE.md` — catalogo variabili d'ambiente
   (l'enforcement è `assertEnvPolicy()` in `apps/api/src/server.ts`)
4. `apps/api/prisma/schema.prisma` — solo i nomi dei model
5. `apps/api/src/routers/` — elenco file router (nomi, non contenuto)
6. `apps/web/src/app/` — albero directory a 2 livelli
7. `docs/` — elenco ricorsivo dei `.md` (titoli H1, path)
8. `.planning/ROADMAP.md` — solo per capire la direzione (non riprodurre)

Costruisci dizionario: `workspace → { name, description, dependents[], envVars[], exports[], scripts[], routerNamespaces[] }`.

**Phase 2 — Genera README** con i template in `references/readme-templates.md`:
root + apps (max 3 in parallelo) → packages (max 3 in parallelo) → `docs/README.md`.

**Phase 3 — Coerenza semantica:** i package name in "Utilizzato da"/"Dipendenze
interne" corrispondono ai nomi reali; le sezioni omesse per informazione mancante
sono segnalate nel report.

La risoluzione dei link e l'integrità dei marker **non** vanno verificate a mano:
`pnpm check:drift` le controlla in CI. Se fallisce, il link va riparato o
cancellato — mai aggiunto a una lista di eccezioni, o il checker diventa arredamento.

---

## Modalità `inline`

**Phase 1 — Audit (obbligatoria).** Costruisci la lista target:

- `packages/**/src/**/*.ts`: export senza JSDoc, JSDoc driftato, `//` su export pubblici
- `apps/api/src/routers/**/*.ts`: procedure senza `/** */` o senza input/output/permesso RBAC
- `apps/api/prisma/schema.prisma`: field e model senza `///`

**Phase 2-4 — Scrivi** seguendo template e logica di merge in `references/inline-rules.md`:
JSDoc packages (max 3 in parallelo) → commenti tRPC (max 3 router in parallelo) → Prisma field docs.

---

## Modalità `adr`

**Phase 1 — Discover:** leggi i file in `docs/decisions/`; per ciascuno estrai
titolo, `Status`, affermazioni chiave dalla sezione Decisione.
Se `docs/decisions/` non esiste: segnala nel report e fermati.

**Phase 2 — Valida** contro la codebase (max 3 ADR in parallelo) secondo
`references/adr-rules.md`. Modifica solo il campo `Status`.

**Phase 3 — Rigenera l'indice** `docs/decisions/README.md`.

---

## Report finale (formato obbligatorio)

```
=== luke-docs report ===

README:
  Creati:     N file
  Aggiornati: N file
  Invariati:  N file
  Sezioni omesse (info mancante): [lista]

INLINE:
  JSDoc aggiunti:   N simboli
  JSDoc aggiornati: N simboli
  Commenti tRPC:    N procedure
  Field Prisma:     N field
  Flag stale code:  N

ADR:
  Validati:            N
  Confermati:          N  (Status invariato)
  Potentially stale:   N  (lista con dettaglio)
  Non verificabili:    N
  Indice aggiornato:   docs/decisions/README.md

Commit suggerito:
  docs: update readme tree, inline comments and adr validation [luke-docs]
```
