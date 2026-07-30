# Lessons Log

Regole nate da correzioni ricevute durante lo sviluppo. Ogni volta che Claude
viene corretto, aggiunge qui una regola per non ripetere l'errore
(vedi CLAUDE.md → Regole di ingaggio).

Formato: `## <regola in una riga>` sotto la categoria giusta, con contesto,
root cause e fix. Nuove categorie ammesse quando serve.

---

## TypeScript & Next.js

### `as any` vietato — usare `as Route` per redirect con typedRoutes

Con `typedRoutes: true` in `next.config.js`, `redirect()` richiede un tipo `Route`.
Per path validi a runtime ma non nel manifest statico (es. route group `(app)`), usare:

```typescript
import type { Route } from 'next';
redirect('/app/dashboard' as Route);
```

Mai `as any` — viola strict mode. Pattern già usato in `NotificationDropdown.tsx`.

---

## Prisma & PostgreSQL

### Soft-delete + slug uniqueness: usare partial index PostgreSQL

Quando un modello ha soft-delete (`isActive: Boolean`) e uno slug che deve restare unico tra i record attivi, la soluzione corretta è un **partial unique index PostgreSQL**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "company_functions_slug_active_key"
  ON "company_functions"("slug") WHERE "isActive" = true;
```

Prisma non supporta partial indexes nel DSL — va aggiunto a mano nella migration SQL.
Rimuovere `@unique` dallo slug in schema.prisma e aggiungere `@@index([slug])` per le query.

Nel router aggiungere guard esplicita in `create` (distingue slug-attivo vs slug-disattivato con messaggio chiaro) e procedure `restore` con anti-collision check.

**Alternativa DB-agnostica** (se mai si cambia DB): al soft-delete, nullare lo slug e salvarlo in `slugOriginal`. `NULL != NULL` in SQL → `@unique` funziona su tutti i DB. Per ora over-engineering: il progetto è locked su PostgreSQL.

### `prisma migrate deploy` su DB dev locale può bloccarsi per drift con `db push`

Il workflow per nuove migration usa `db push` (porta 5432) — questo NON scrive su
`_prisma_migrations`. Se in passato è stato lanciato `migrate deploy` sullo stesso DB,
può fallire a metà lasciando una riga `finished_at = NULL` che blocca ogni deploy successivo.

Diagnosi e fix completi: `docs/prisma-migration-workflow.md` → Troubleshooting.
Regola: mai `resolve --applied` senza aver verificato che il DB rifletta davvero quello stato.

---

## tRPC & Fastify

### tRPC 11.18 + Fastify: UNSUPPORTED_MEDIA_TYPE / Unable to transform

**Problema**: upgrade tRPC 11.8→11.18 introduce protocollo streaming JSONL (`trpc-accept: application/jsonl`). Sia `httpBatchLink` che `httpBatchStreamLink` danno errori runtime.

**Root cause**: tRPC 11.18 aggiunge `isDataStream()` check — lancia `UNSUPPORTED_MEDIA_TYPE` se una procedura ritorna un oggetto con valori `Promise` o `AsyncIterable` in path non-streaming. Il Fastify custom content-type parser interferisce con `incomingMessageToRequest`.

**Fix**: usare `httpBatchStreamLink` (import da `@trpc/client`, non `@trpc/react-query`) + aggiungere `trpc-accept: application/jsonl` esplicito nelle headers custom del client. Indagare quale procedura ritorna Promise-valued fields non awaited.

---

## Dependencies

### Non duplicare librerie per lo stesso scopo

Se una libreria è già installata nel progetto (es. `pdfmake`), usarla — mai aggiungerne un'altra che fa la stessa cosa (es. `pdfkit`). Controllare sempre `package.json` prima di installare nuove dipendenze.

---

## Rate Limiting

### Nuova route rate-limited: aggiornare ENTRAMBE le mappe (drift = crash runtime)

Il rate limit vive in due mappe separate che devono restare in sync:

- `RATE_LIMIT_CONFIG` in `apps/api/src/lib/ratelimit.ts` — consumata da `withRateLimit(routeName)`.
- `DEFAULTS` in `apps/api/src/lib/rateLimitPolicy.ts` — consumata da `resolveRateLimitPolicy()` (cascata AppConfig → ENV → default).

`withRateLimit('foo')` chiama `resolveRateLimitPolicy('foo')`: se `foo` esiste solo in `RATE_LIMIT_CONFIG` ma NON in `DEFAULTS`, `DEFAULTS[routeName]` è `undefined` → `def.max` lancia `Cannot read properties of undefined (reading 'max')` a runtime (non a compile-time: il cast al call site nasconde il drift a TypeScript).

**Regola**: ogni nuova route rate-limited va aggiunta in TRE posti in sync:
1. `RATE_LIMIT_CONFIG` (`ratelimit.ts`)
2. `DEFAULTS` (`rateLimitPolicy.ts`) — **obbligatorio, altrimenti crash**
3. `RateLimitConfigSchema` (`packages/core/src/schemas/appConfig.ts`) — campo `.optional()`, altrimenti un override AppConfig/ENV viene silenziosamente ignorato dal resolver.

Regressione reale: `navSyncTrigger` mancante da `DEFAULTS` → sync fornitori NAV in crash in produzione (hotfix v1.9.1).

## Test di integrazione

### L'ordine dei file di test non è alfabetico né stabile

Vitest usa un proprio sequencer: due esecuzioni su macchine diverse possono
eseguire i file in ordine diverso. Ogni suite che assume "un'altra ha già
creato le tabelle" o "un'altra ha già pulito i dati" funziona **per caso**.

Regressione reale: il job CI `integration` è fallito al primo giro con 40 test
rossi, mentre in locale passava da mesi. Due cause, entrambe invisibili su un
database già popolato:

- `resetTestData()` memoizzava l'elenco tabelle **anche quando vuoto**. Su un
  database senza schema la query tornava zero righe, venivano memoizzate, e da
  lì in poi la funzione era un no-op silenzioso per tutto il file: i test
  giravano senza isolamento e collidevano sui dati a codice fisso.
- quattro suite costruivano le fixture con `createTestPrismaClient()` in
  `beforeAll`, prima di qualunque `ensureTestSchema()`.

**Regole**:

1. Una suite di integrazione ottiene il client **solo** da `setupTestDb()` o
   `createTestContext()` — mai da `createTestPrismaClient()` diretto. Entrambi
   garantiscono lo schema e troncano.
2. Mai memoizzare un risultato vuoto se il vuoto è uno stato transitorio: o si
   garantisce la precondizione prima di calcolarlo, o non si memoizza.
3. Un helper di isolamento che non riesce a isolare deve **sollevare**, non
   proseguire: test senza isolamento passano verdi e non provano niente.
4. Prima di dichiarare verde una suite di integrazione, provarla almeno una
   volta su un database vergine (`DROP SCHEMA public CASCADE; CREATE SCHEMA
   public;`). Un DB di sviluppo accumula stato che maschera le dipendenze
   d'ordine.

## CI / Gate di sicurezza

### Un job `schedule` gira solo se il workflow esiste sul branch di default

GitHub esegue i trigger `schedule` usando i file di workflow del **branch di
default**, non del branch dove il file è stato scritto. Un `cron` su un workflow
che vive solo su un branch di sviluppo non parte mai, e non produce alcun
errore: semplicemente non esiste alcuna esecuzione.

Regressione reale: `security.yml` aveva `osv-push` con `continue-on-error: true`
("report-only sui push") e `osv-weekly` bloccante, con il commento *"il fail
settimanale è il segnale vero"*. Ma `security.yml` esisteva solo su
`develop-2.1`, mai su `main`: in 24 esecuzioni del workflow, zero da schedule.
L'unico job che girava era volutamente non bloccante, e quello bloccante non
aveva un file da eseguire. Sono passate inosservate 24 vulnerabilità note — 3
critiche (CVSS 9.1) su `next-auth`/`@auth/core`, fra cui un bypass di
autenticazione via omoglifi nella normalizzazione email.

**Regole**:

1. Prima di affidare un controllo a un `schedule`, verificare che il workflow
   sia sul branch di default: `git ls-tree --name-only origin/main .github/workflows/`.
2. Controllare che sia davvero partito almeno una volta:
   `gh run list --workflow <nome> --limit 30 --json event -q '.[].event' | sort | uniq -c`.
   Zero `schedule` significa che il gate non esiste.
3. `continue-on-error: true` su un job di sicurezza va accompagnato da un gate
   che blocca davvero, e quel gate va verificato in esecuzione — non solo scritto.
4. Un workflow che risulta `success` non dice che i suoi job siano passati:
   `continue-on-error` maschera il fallimento a livello di run. Guardare i job:
   `gh run view <id> --json jobs -q '.jobs[] | "\(.conclusion)\t\(.name)"'`.

### Gli `overrides` di pnpm possono pinnare una versione vulnerabile

`pnpm-workspace.yaml` conteneva `brace-expansion@1: '1.1.16'` e analoghi, aggiunti
per deduplicare. Quando è uscita GHSA-mh99-v99m-4gvg (range `<= 5.0.7`, fix solo
in 5.0.8) l'override ha continuato a forzare la versione vulnerabile, e
`pnpm update` non poteva farci nulla: l'override vince.

**Regola**: un override che pinna una versione **esatta** è debito a scadenza. Se
si pinna, pinnare un range (`'>=x.y.z'`) e rivedere gli override ad ogni finding
di `pnpm security:deps`.

### Le negazioni in `.gitignore` non rientrano sotto una directory esclusa

`.gitignore` conteneva `.claude/`. Aggiungere `!.claude/skills/**` sotto quella
riga **non** avrebbe funzionato: un pattern che esclude una directory fa sì che
git non la percorra affatto, e nessuna negazione al suo interno può più
riammettere nulla. Il fix sarebbe stato scritto, committato, e silenziosamente
inerte — con le skill ancora fuori da git.

La forma corretta esclude il **contenuto** un livello sotto, perché `*` non
matcha `/`:

```gitignore
.claude/*
!.claude/skills/
!.claude/hooks/
!.claude/settings.json
.claude/settings.local.json
```

**Regole**:

1. Per riammettere qualcosa dentro una directory ignorata, escludere `dir/*`,
   mai `dir/`.
2. Verificare sempre con l'**exit code**, non con l'output: `git check-ignore -v`
   stampa la regola anche quando è una negazione (prefissata `!`), quindi
   "ha stampato qualcosa" non significa "è ignorato". Usare
   `git check-ignore -q <file>` — 0 = ignorato, 1 = tracciabile.
3. Controprova finale: `git add -An <dir>` elenca esattamente ciò che entrerebbe.

### Una skill con `agent: Explore` non può invocare subagenti

`luke-audit`, `luke-bugs` e `luke-security` dichiaravano `agent: Explore` e
contenevano "Run 3 agents in parallel" con tre brief dettagliati. L'agente
Explore ha tutti i tool **tranne** Agent: il fan-out non è mai avvenuto, e
degradava in silenzio a un passaggio singolo. Nessun errore, nessun segnale —
solo report prodotti in un modo diverso da quello dichiarato, per mesi.

Il fix non è passare a `agent: general-purpose`: quelle skill sono read-only, e
oggi il vincolo è garantito dal tipo di agente, che non ha tool di scrittura.
Sbloccare i subagenti avrebbe consegnato loro Write ed Edit, degradando un
invariante strutturale a un'istruzione in prosa.

**Regole**:

1. Prima di scrivere istruzioni di orchestrazione in una skill, verificare che
   il tipo di agente dichiarato abbia il tool Agent.
2. Verificato da `tools/scripts/check-skill-integrity.ts`, bloccante in CI.
3. Vale in generale: un'istruzione che il runtime non può eseguire non fallisce,
   viene ignorata. È la forma più silenziosa di controllo inerte.

### Un test che parte da un sotto-router salta la composizione

`brand.integration.spec.ts` usava `brandRouter.createCaller(ctx)`. Ma
`router({ brand: brandRouter })` **non conserva** `brandRouter`:
`createRouterFactory` ne ricostruisce un aggregato, e il sotto-router importato
mantiene una propria mappa `_def.procedures` separata. Il test esercitava quindi
un percorso che la produzione non prende mai — la produzione entra sempre da
`appRouter`.

Trovato dal gate di copertura procedure, che misura le invocazioni su
`appRouter`: il router meglio testato del repo risultava 7/7 non invocato.

**Regola**: nei test tRPC, costruire il caller da `appRouter` e scendere al
namespace (`appRouter.createCaller(ctx).brand`), mai dal sotto-router importato.
La forma dei call site resta identica.

### Un checker che legge stato locale passa in locale e fallisce in CI

`check-skill-integrity.ts` verificava l'esistenza dei path citati dalle skill.
`luke-docs` cita `.planning/ROADMAP.md`, che `.gitignore` esclude: esiste sul
disco di chi lavora, non in un checkout pulito. Verde in locale, rosso al primo
push — dentro lo script scritto proprio per intercettare controlli che leggono
il mondo sbagliato.

**Regola**: uno script di verifica deve pronunciarsi solo su ciò che il repo
contiene. Se un path è escluso da git, la sua esistenza non è un fatto
verificabile: `git check-ignore -q -- <path>` (exit 0 = ignorato) e si salta.
Stessa scelta in `check-docs-integrity.ts`, che prende i file da `git ls-files`
invece di camminare il filesystem.

Corollario: prima di dichiarare verde un controllo nuovo, chiedersi *quali file
sto leggendo che un clone pulito non avrebbe*.
