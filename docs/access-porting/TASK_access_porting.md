# Task: Reverse Engineering Access → Luke (NAV Statistics Module)

## Contesto del progetto

Stai lavorando su **Luke**, un monorepo Node.js (`pnpm` + Turborepo) con la seguente struttura:

```
luke/
├── apps/
│   ├── web/          # Next.js 15 + shadcn/ui (frontend)
│   └── api/          # Fastify 5 + tRPC + Prisma (backend)
├── packages/
│   ├── core/         # @luke/core — Zod schemas, RBAC, utilities condivise
│   └── nav/          # @luke/nav — layer di accesso a Microsoft NAV (già esistente)
└── [config files]
```

### Il package `@luke/nav` è già esistente e maturo

**Non creare** `packages/nav` da zero. Il package esiste già con questa struttura:

```
packages/nav/
├── package.json          # name: "@luke/nav", dipendenze: mssql, pino, @luke/core, @prisma/client
├── src/
│   ├── index.ts          # barrel export
│   ├── config.ts         # getNavDbConfig(), sanitizeCompany(), tipo NavDbConfig e GetConfigFn
│   ├── client.ts         # getPool(), closePool(), testNavConnection() — pool singleton mssql
│   └── sync/             # orchestratore sync NAV→Postgres (vendor, brand, season)
│       ├── index.ts      # runNavSync()
│       ├── vendors.ts    # syncVendors() con sync differenziale watermark
│       ├── brands.ts     # syncBrands()
│       ├── seasons.ts    # syncSeasons()
│       └── utils.ts      # buildNavSyncFilter(), buildWhereClause(), processInBatches()
```

**Pattern consolidati in `@luke/nav` da rispettare obbligatoriamente:**

1. **Dependency injection di `getConfig`** — la firma è `GetConfigFn = (prisma, key, decrypt) => Promise<string | null>`. Non importare mai `configManager` direttamente; ricevere `getConfig` come parametro.
2. **Company prefix via `sanitizeCompany(config.company)`** — usare sempre questa funzione per costruire i table name `[COMPANY$NomeTabella]`. Non concatenare stringhe raw.
3. **Pool singleton via `getPool(config)`** — non creare mai pool locali nelle query di statistica; riusare il pool esistente.
4. **Signature coerente con i sync esistenti** — le nuove funzioni query/statistica in `src/statistics/` devono accettare `(pool, prisma, config, logger)` come i sync esistenti.
5. **Export da `src/index.ts`** — aggiungere ogni nuova funzione/tipo pubblica al barrel export.

**Configurazione NAV in AppConfig:**
Le chiavi sono `integrations.nav.host`, `integrations.nav.port`, `integrations.nav.database`, `integrations.nav.user`, `integrations.nav.password` (cifrata), `integrations.nav.company`, `integrations.nav.readOnly`.

**Schema Zod in `@luke/core`:**
`navConfigSchema` e `navConfigResponseSchema` sono già in `packages/core/src/schemas/nav.ts`. Riutilizzarli per validare output delle query statistiche se necessario.

**Obiettivo di questa task:** fare il porting completo di un file Microsoft Access (`.accdb`) che oggi interroga NAV e produce statistiche esportate in Excel. Il risultato atteso sono:

1. Un documento di reverse engineering completo (`docs/access-porting/REVERSE_ENGINEERING.md`)
2. Le query riscritte in T-SQL pulito per SQL Server, pronte per essere aggiunte in `packages/nav/src/statistics/` (`docs/access-porting/queries/`)

---

## Istruzioni operative

> **Lavora una fase alla volta. Non passare alla fase successiva senza aver completato e salvato gli output della fase corrente. Conferma il completamento di ogni fase con un breve summary.**

---

## FASE 1 — Estrazione raw dal file .accdb

**File sorgente:** `docs/access-porting/NewEraStat.accdb`

### 1a. Rilevamento ambiente e strumento di estrazione

Prima di tutto, determina quale strumento usare:

- Su **Linux/Mac**: verifica se `mdbtools` è installato (`mdb-tables --version`). Se non disponibile, installalo o usa Python con `subprocess`.
- Su **Windows**: usa Python con `pyodbc` e il driver Access ODBC (`Microsoft Access Driver (*.mdb, *.accdb)`), oppure `comtypes`/`win32com` per aprire Access via COM automation.

Scrivi ed esegui uno script Python (`docs/access-porting/scripts/extract_accdb.py`) che estragga e salvi in `docs/access-porting/raw/`:

| Output file         | Contenuto                                        |
| ------------------- | ------------------------------------------------ |
| `tables.txt`        | Lista di tutte le tabelle (locali + linked)      |
| `queries_sql.txt`   | SQL di ogni query salvata, con nome              |
| `queries_list.json` | Array `[{name, type, sql}]` per ogni query       |
| `vba_modules.txt`   | Codice sorgente di tutti i moduli VBA            |
| `forms_list.txt`    | Lista form con i controlli principali            |
| `reports_list.txt`  | Lista report con le query/recordsource associate |

> Se l'accesso diretto non è possibile, istruisci l'utente su come esportare manualmente e procedi con i file esportati.

---

## FASE 2 — Analisi e reverse engineering delle query

Leggi i file estratti nella fase 1. Per ogni query trovata in `queries_list.json`, analizzala e compila la documentazione in `docs/access-porting/REVERSE_ENGINEERING.md`.

### Struttura del documento da produrre

```markdown
# Reverse Engineering — Access Statistics Module

## Panoramica

- N. query totali: X
- N. moduli VBA: X
- Query collegate a form: X
- Query collegate a report: X
- Tabelle NAV referenziate: [elenco]

## Catalogo Query

### QRY_001 — [NomeMnemonico]

**Nome Access:** `[nome originale nel file]`
**Tipo:** [Select / Crosstab / Action / Pass-Through]
**Usata in:** [Form: X / Report: Y / VBA: Z / Standalone]
**Complessità:** [Bassa / Media / Alta] — [motivazione in 1 riga]

**Scopo business:**
[Descrizione in italiano di cosa calcola/mostra questa query, in termini di dominio (vendite, margini, clienti...)]

**Tabelle NAV coinvolte:**
| Tabella | Alias | Join type | Campi usati |
|---|---|---|---|
| [AZIENDA$Sales Header] | sh | INNER | No., Sell-to Customer No., ... |

**Logica chiave:**

- [Bullet point sui filtri, aggregazioni, calcoli derivati rilevanti]
- [Eventuali parametri Access ([Forms]![...]) → tradurli come variabili da passare]

**Dipendenze da altre query Access:**

- [NomeQueryDipendente] — [motivo]

**Note per il porting:**

- [Problemi attesi: funzioni Access-specific, sintassi Jet, IIf(), ecc.]
- [Suggerimenti per la riscrittura in T-SQL]
```

> Ripeti la sezione `### QRY_NNN` per ogni query. Numera in ordine di complessità crescente (prima le semplici, poi le complesse).

---

## FASE 3 — Analisi del codice VBA

Per ogni modulo VBA trovato in `raw/vba_modules.txt`, documenta nella sezione `## Moduli VBA` del documento:

```markdown
### VBA — [NomeModulo]

**Tipo:** [Standard Module / Class Module / Form Module / Report Module]
**Responsabilità principale:** [cosa fa in 1-2 righe]

**Funzioni/Sub rilevanti per il porting:**
| Nome | Scopo | Logica da replicare in Luke |
|---|---|---|
| `ExportToExcel()` | Genera xlsx da query X | tRPC endpoint + `exceljs` |

**Dipendenze da librerie COM/ActiveX:**

- [DAO, ADODB, Excel Object Model, ecc.]

**Parametri utente intercettati:**

- [Date picker, dropdown, checkbox che fungono da filtro → da mappare come input UI in Luke]
```

---

## FASE 4 — Riscrittura query in T-SQL

Per ogni query documentata nella Fase 2, crea un file T-SQL in `docs/access-porting/queries/QRY_NNN_nome_mnemonico.sql`.

### Regole di riscrittura obbligatorie

1. **Sintassi SQL Server** — niente Jet SQL, niente `IIf()` (usa `CASE WHEN`), niente `&` per concatenazione (usa `+` o `CONCAT()`), niente `#date#` (usa `'YYYY-MM-DD'`).
2. **Prefisso tabelle NAV** — usa sempre `[AZIENDA$NomeTabella]` (placeholder da sostituire con il company prefix reale, definito in una costante in cima al file o come parametro).
3. **Parametri espliciti** — ogni valore che in Access veniva da un form (`[Forms]![...]`) diventa un parametro `@NomeParametro` con tipo e commento.
4. **CTE preferite ai subquery annidati** — usa `WITH cte AS (...)` per leggibilità.
5. **Commento header obbligatorio** in ogni file:

```sql
-- ============================================================
-- QRY_NNN — [Nome Mnemonico]
-- Fonte originale: [nome query in Access]
-- Scopo: [descrizione business 1 riga]
-- Parametri:
--   @DataDa   DATE  — inizio periodo (era [Forms]![frmMain]![txtDataDa])
--   @DataA    DATE  — fine periodo
-- Note porting: [eventuali avvertenze]
-- ============================================================
```

6. **NON eseguire mai le query** — né in lettura né in scrittura. I file `.sql` sono solo documentazione. Non tentare connessioni al database in nessuna fase di questo task.

---

## FASE 5 — Documento di sintesi finale

Aggiorna `docs/access-porting/REVERSE_ENGINEERING.md` aggiungendo una sezione finale:

```markdown
## Mappa di porting verso Luke

### Raggruppamento funzionale

[Raggruppa le query per area tematica: Vendite, Margini, Clienti, Agenti, ...]

### Query prioritarie (MVP dashboard)

[Indica le 5-10 query che coprono l'80% del valore, motivando la scelta]

### Query da deprecare / non portare

[Query ridondanti, obsolete, o già coperte da altre — con motivazione]

### Dipendenze tecniche da risolvere prima del porting in Luke

- [ ] `packages/nav` (`@luke/nav`) da creare con struttura base
- [ ] Company prefix NAV da leggere da `AppConfig` (non hardcoded)
- [ ] Driver SQL Server: scegliere tra `mssql` e `tedious` per `@luke/nav`
- [ ] Libreria Excel export: `exceljs` in `@luke/nav/excel`
- [ ] Strategia export pivot: raw data → frontend, oppure server-side con template?
- [ ] `@luke/nav` aggiunto come dipendenza in `apps/api/package.json`

### Stima effort implementazione in Luke

| Area                       | N. query | Complessità stimata | Note               |
| -------------------------- | -------- | ------------------- | ------------------ |
| tRPC endpoints (api)       | X        | M                   | ...                |
| Componenti dashboard (web) | X        | M                   | ...                |
| Export Excel               | X        | B                   | exceljs già usato? |
```

---

## Vincoli e note generali

- **Non modificare** file al di fuori di `docs/access-porting/` durante queste fasi.
- **Nomenclatura file:** usa sempre snake_case per i file `.sql` e `.md`.
- **Lingua documentazione:** italiano per le descrizioni business, inglese per commenti tecnici nel codice SQL.
- **Se una query è ambigua** nel suo scopo business, segnalala con `⚠️ CHIARIMENTO RICHIESTO:` e vai avanti — non bloccarti.
- **NON eseguire codice SQL sul database NAV** — né query SELECT né tantomeno Action Query (INSERT, UPDATE, DELETE, DDL). Il rischio di danni al database operativo è reale. Tutta la fase di verifica e testing è responsabilità del developer, avverrà in un secondo momento su decisione esplicita.
- **Salva i progressi frequentemente.** Dopo ogni blocco di 5-10 query documentate, scrivi su disco.

---

## Checklist di completamento

Prima di dichiarare la task completata, verifica:

- [ ] `docs/access-porting/raw/` contiene tutti i file di estrazione
- [ ] `REVERSE_ENGINEERING.md` ha una sezione per ogni query
- [ ] `REVERSE_ENGINEERING.md` ha una sezione per ogni modulo VBA rilevante
- [ ] Ogni query ha il suo file `.sql` in `docs/access-porting/queries/` (solo documentazione — nessuna query eseguita)
- [ ] Il documento di sintesi finale è completo (inclusa stima effort per `@luke/nav`)
- [ ] `packages/nav/` creato con struttura base, `package.json` e `tsconfig.json` allineati alle convenzioni del monorepo
- [ ] Nessun file modificato fuori da `docs/access-porting/` e `packages/nav/`
