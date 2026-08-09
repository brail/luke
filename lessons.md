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

### `crypto.randomUUID()` bare in un componente client crasha fuori da secure context

`settings/collection-control/page.tsx` chiamava `crypto.randomUUID()` diretto per
generare le key React di `BandSetEditor`. In produzione, su un host raggiunto
via HTTP semplice (non HTTPS/localhost), il Web Crypto API non espone
`randomUUID` — `TypeError: crypto.randomUUID is not a function`, pagina intera
sostituita dall'error boundary di `app/error.tsx`. Il pattern corretto esisteva
già in due punti del repo (`lib/trpc.tsx`, `CollectionRowDrawer.tsx`) ma non era
stato applicato qui: bug noto, fix noto, semplicemente non riusato.

Corretto in loco con il fallback già in uso altrove:

```ts
crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36)
```

ma un fix inline non impedisce la ricorrenza — richiesto esplicitamente di
**promuovere a regola** invece di limitarsi a patchare il file. Creata
`@luke/no-bare-client-random-uuid` in `packages/eslint-plugin-luke/rules/`:
segnala `crypto.randomUUID()` non-opzionale in qualunque file con direttiva
`'use client'` in testa (i Server Component girano in Node, dove l'API è
sempre disponibile — la regola li ignora per costruzione, controllando `Program.body[0]`).
Wired in `eslint.config.mjs` scoping su `apps/web/src/**`, error.

**Regola**: un bug di runtime dovuto a un'API che il codice usa in un solo
posto "per errore" mentre altrove è già gestita correttamente va chiuso con
una regola ESLint enforced, non con la sola correzione del call site — il
prossimo `crypto.randomUUID()` bare va bloccato al commit, non scoperto in
produzione da un errore generico senza stack trace visibile all'utente.

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

### Bucket `keyBy: 'ip'` su una chiamata server-to-server è silenziosamente inutile

**Problema**: pentest Strix su RC segnala `/api/auth/callback/credentials` senza throttling osservabile (18 tentativi, tutti `200 OK`, nessun `429`).

**Root cause**: `auth.login` aveva già `withRateLimit('login')` (5/60s, `keyBy: 'ip'`), ma `apps/web/src/auth.ts` chiama `auth.login` **server-to-server** (fetch diretta a `INTERNAL_API_URL`, non passa dal reverse proxy). Senza inoltrare esplicitamente l'IP del client originale, `ctx.req.ip` su apps/api risolve sempre allo stesso indirizzo interno (il container web) per **qualunque** utente — un bucket condiviso da tutta l'app invece che per-attaccante. In più, NextAuth v5 risponde sempre `200` quando `authorize()` ritorna `null`, quindi anche un limiter che scatta è invisibile dall'esterno: l'osservazione del pentest non prova che manchi la protezione, prova solo che il segnale non attraversa quel confine.

**Regola**: un bucket `keyBy: 'ip'` aggiunto su un endpoint raggiungibile anche via una chiamata server-to-server (non solo browser→proxy→api) va sempre accompagnato da (1) inoltro esplicito dell'IP reale su quella chiamata interna e (2) un test che dimostri il comportamento *per-attaccante* — non basta il test sul formato della config. Vedi `apps/api/test/ratelimit.integration.spec.ts`, describe `blocks valid credentials too`, e CLAUDE.md → Development Patterns #12/#13.

### Endpoint di login: bucket IP da solo non ferma il password-spray

Un bucket `keyBy: 'ip'` ferma un attaccante che martella un IP, ma non uno spray distribuito su molti IP contro un singolo account. Login (e ogni endpoint credential-verification) deve avere **sempre** un secondo bucket `keyBy` sull'identità (username/account) oltre a quello IP. Pattern: `login` + `loginByUsername` in `apps/api/src/lib/ratelimit.ts` — il secondo bucket è verificato direttamente in `authenticateUser()` (`auth.service.ts`), non tramite `withRateLimit()`, perché la chiave (username) vive nell'input della procedura, non in `ctx`.

## Pentest / Sicurezza esterna

### Scan Strix (o altri) vanno puntati SOLO su hostname reali deployati

**Problema**: uno scan Strix contro `http://host.docker.internal:3000` ha segnalato "development mode information disclosure" (stack trace, path assoluti, `next-devtools` esposti).

**Root cause**: lo scanner girava dentro un container Docker sulla stessa macchina dello sviluppatore; `host.docker.internal` è l'alias Docker Desktop che risolve all'host — ha semplicemente raggiunto il `pnpm dev` locale (`next dev`, dev mode per design), non un ambiente reale. Verificato: Dockerfile/tutti i `docker-compose*.yml`/CI buildano sempre `next build` + `next start` con `NODE_ENV=production`; nessun path di deploy reale può servire dev mode.

**Regola**: uno scan di sicurezza va **sempre** puntato su un hostname realmente deployato (`rc.luke.febos.local`, dominio prod), mai su `localhost`/`host.docker.internal`. Un "development mode disclosure" contro uno di questi due è un falso positivo per costruzione, non un finding da triagare.

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

Ci sono volute **tre CI rosse**, e ogni ricaduta ha aggiunto un dettaglio.

1. *Applicare la regola a metà.* `check-docs-integrity.ts` la usava per scegliere
   quali file leggere (`git ls-files`), `check-skill-integrity.ts` non la usava
   affatto. Sistemato il secondo, il primo continuava a verificare i **target dei
   link** ignorati. Una regola condivisa fra due script va messa in un posto solo
   — ora `tools/scripts/lib/gitPaths.ts`.
2. *Lo slash finale.* Un pattern directory-only (`docs/access-porting/`) matcha
   solo se git può stabilire che il path è una directory. Quando il path **non
   esiste** — cioè il caso che qui interessa — non può, e serve passarglielo con
   lo slash. `path.resolve()` lo strippa:

   ```
   docs/access-porting    → exit 1, non matcha
   docs/access-porting/   → exit 0, matcha
   ```

3. *Verificare dove non può fallire non è verificare.* Le prime due correzioni
   sono state dichiarate verdi girando sul disco di sviluppo, che ha i file
   gitignored. Riprodurre il checkout pulito è una riga:

   ```bash
   git worktree add --detach /tmp/clean HEAD   # per costruzione, niente file ignorati
   ```

Corollario: prima di dichiarare verde un controllo nuovo, chiedersi *quali file
sto leggendo che un clone pulito non avrebbe* — e poi provarlo su un clone pulito,
invece di rispondere a memoria.

---

### Una regola di lint nuova va sondata su un file-esca, non sul repo

Scritta `brand-scope-required.yml`, girata su `apps/api/src`, zero finding,
dichiarata fatta. Sbagliato tre volte di fila, e ogni volta lo zero sembrava la
prova che funzionasse.

1. *YAML non valido.* Il pattern conteneva `{ ..., brandId: $Z, ... }` non
   quotato, e i due punti rompono lo scalare. Semgrep rispondeva
   `invalid configuration file found` su stderr ed usciva **0**: il comando
   sembrava passato e la regola non stava girando affatto.
2. *`pattern-not` che non esclude.* Con `<... assertBrandAccess(...) ...>` semgrep
   segnalava anche le procedure correttamente guardate. `metavariable-pattern`
   non cambiava nulla. Ha funzionato `pattern-not-regex`, testuale sulla regione
   matchata.
3. *Alternativa letterale al posto della famiglia.* `assertBrandAccess` come
   stringa esatta continuava a segnalare chi era guardato da
   `resolveRowBrandAccess`. Serviva `BrandAccess`.

I punti 2 e 3 sono la variante peggiore: **falsi positivi su una regola
bloccante**. Una regola che segnala il codice corretto viene disattivata entro
una settimana, quindi è peggio di non averla.

**Regola**: prima di considerarla scritta, una regola semgrep va provata su un
file-esca che contiene *entrambi* i casi — quello vulnerabile e quello già
corretto — e deve dare esattamente 1 finding e 0. Zero finding sul repo reale non
distingue "nessuna violazione" da "la regola non gira".

```bash
mkdir -p /tmp/probe/apps/api/src/routers && $EDITOR /tmp/probe/.../bad.ts
cd /tmp/probe && semgrep --config <regola> .    # atteso: 1 finding, sul caso rotto
```

Corollario che ha ripagato subito: appena la regola ha iniziato a funzionare
davvero ha trovato cinque procedure in `merchandisingPlan.ts` e `phaseAlert.ts`
che né l'audit né il piano avevano enumerato.

---

### `vi.mock` non sempre intercetta: asserire sull'effetto, non sullo spy

Nel test del logo aziendale, `vi.mock('../src/storage', ...)` non arrivava
all'import di `deleteObjectByKey` fatto da `routers/company.ts` — né con quello
specifier né con `'../src/storage/index.js'`. Il router chiamava la funzione
reale, il `catch` best-effort se la mangiava, e lo spy restava a zero chiamate.
Diagnosticato solo mettendo `(fn as any)._isMockFunction` dentro un throw
temporaneo.

**Regola**: quando un mock di modulo non intercetta, prima di combattere la
risoluzione conviene chiedersi se l'effetto è osservabile altrove.
`deleteObjectByKey` cancella anche la riga `FileObject`, quindi

```ts
expect(await prisma.fileObject.findUnique({ where: { id } })).toBeNull();
```

è più corta della lotta col mock **e** più forte: prova che sia girata la
funzione vera, non che sia stato chiamato uno stub.

Vale solo quando l'effetto è reale e osservabile. Se il collaboratore è davvero
esterno (rete, SMTP), il mock resta l'unica via e va fatto funzionare.

### Un `cd dir && comando` cambia la cwd anche per i comandi dopo

Dopo `cd apps/api && npx tsc -b`, la cwd bash restava `apps/api/` per il
comando successivo (`grep -r apps/api ...`), che quindi cercava
`apps/api/apps/api` — path inesistente, silenziato da `2>/dev/null`,
risultato "0 match" letto come "bonifica completa". Ho riportato all'utente
"apps/api: 0 residui, lavoro completo" quando in realtà restavano ~30 file
con commenti IT non tradotti — scoperto solo perché l'utente ha aperto a mano
`server.ts` e ci ha trovato commenti italiani.

**Regola**: mai `cd dir && comando`. Usare `(cd dir && comando)` in subshell,
o passare il path diretto al tool (`npx tsc -b apps/api`), o tornare alla
root subito dopo. Ogni check di verifica che segue un comando con `cd` va
fatto con path assoluti, non relativi alla cwd presunta — specialmente prima
di dichiarare un lavoro "completo" all'utente.

---

## Release / Docker

### Mai buildare l'immagine Docker in locale per "validare prima del commit"

Piano di hotfix (resize immagini via `sharp`) prevedeva come step obbligatorio
un `docker build` locale del Dockerfile completo per verificare il binario
nativo prima del commit. L'utente ha interrotto: **le build Docker sono
"roba online GitHub"** — avvengono in CI (`.github/workflows/release.yml` →
build+push su `ghcr.io` al tag), non sulla macchina di sviluppo. Il tentativo
locale ha anche esposto perché è la via sbagliata: la build del monorepo
intero dentro Docker Desktop (risorse limitate rispetto alla macchina host)
è andata OOM nella fase `tsc` di `@luke/api`, un fallimento del tutto
scollegato dal binario nativo che si voleva verificare — rumore, non segnale.

**Regola**: non proporre/eseguire `docker build` locale come step di
validazione pre-commit. La build reale (e l'unico posto dove il binario
nativo di una dipendenza come `sharp` viene davvero verificato) è la pipeline
CI innescata dal push del tag `vX.Y.Z`. Per de-rischiare dipendenze native
prima del commit, verificare invece staticamente (Dockerfile base image,
`pnpm-workspace.yaml` overrides/allowBuilds, target arch in
`docker/build-push-action`) e poi fidarsi della CI come gate reale.
