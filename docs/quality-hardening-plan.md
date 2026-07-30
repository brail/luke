# Quality Hardening Plan

Piano di consolidamento dei controlli qualità su Luke. Nasce dall'assessment del
2026-07-29: la pipeline copriva bene l'analisi **statica** (semgrep, gitleaks, osv,
eslint, typecheck, skill `luke-*`, `simplify`) ma **zero verifica comportamentale**.

Documento operativo: sopravvive alle sessioni, si aggiorna man mano.
Stato: 🟢 fatto · 🟡 in corso · ⚪ da fare

---

## 1. Assessment iniziale (2026-07-29)

### Cosa funzionava

| Layer | Copertura |
|---|---|
| Segreti | gitleaks in `pre-commit` + CI |
| SAST | semgrep ERROR-tier in `pre-commit`, community ruleset in CI |
| Dipendenze | osv-scanner (report-only sui push, bloccante settimanale) |
| Stile / tipi | eslint + `tsc --noEmit` in CI |
| Commit | commitlint via `.husky/commit-msg` |
| Env policy | `assertEnvPolicy()` blocca il boot in produzione |
| Versioni | `sync-version` + `post-checkout` hook |
| Analisi LLM | `simplify` ad ogni implementazione, `luke-*` periodiche |

### Il buco

**36 file di test, 359 test scritti — mai eseguiti.** Né in CI
(`.github/workflows/ci.yml` = solo lint + typecheck), né in husky, né via script
root (`package.json` non aveva un task `test`, benché `turbo.json` lo definisse già).

Stato misurato al primo run:

| Suite | Risultato |
|---|---|
| `@luke/core` | 2 falliti / 87 |
| `@luke/api` | 26 file falliti / 36 — 143 test falliti / 359 |

Conseguenza diretta: la sola cosa che verifica il *comportamento* del codice era
marcia da mesi senza che nulla lo segnalasse.

---

## 2. Triage dei fallimenti

Cinque root cause distinte, non 143 problemi separati.

### RC-1 — Drift della permission matrix 🟢

`packages/core/src/auth/__tests__/permissions.test.ts` asseriva conteggi hardcodati:
la risorsa `audit` era censita con 1 azione (`read`), il codice ne ha 2
(`read`, `read_all`, introdotta con l'audit log viewer e usata in
`apps/api/src/routers/auditLog.ts:95` e `packages/core/src/schemas/rbac.ts:72`).

Test stale, non regressione. **Fix alla radice**: i due test ora derivano i
conteggi da `VALID_RESOURCE_ACTIONS` invece di hardcodarli — l'invariante è la
relazione (`permessi per risorsa = azioni + wildcard`, `righe CSV = azioni`), non
il numero. Non può più driftare all'aggiunta di un'azione.

### RC-2 — Helper di test fossili (era SQLite) 🟢

`test/helpers/database.ts` e `test/helpers/test-db.ts` costruivano il client su
`file:${TEST_DB_PATH}` — **SQLite**. Il progetto è su PostgreSQL da mesi
(`provider = "postgresql"` sia dev che prod). Ogni test che passa da `setupTestDb()`
esplodeva su `PrismaClientInitializationError`.

Aggravante: usavano anche l'opzione `datasources`, **rimossa in Prisma 7**
(`PrismaClientConstructorValidationError: Unknown property datasources`).

Verificato: `datasources` **non** compare nel codice applicativo — nessun impatto in
produzione. Restava in `apps/api/scripts/migrate-collection-layout.ts` (script
one-shot, sistemato per coerenza).

### RC-3 — `requirePermission` testato via internals 🟢

`test/permissions.spec.ts` invocava `requirePermission('brands:create')` come
funzione diretta: `middleware({ ctx, next })`. Ma `requirePermission` ritorna
`t.middleware(...)`, cioè un *MiddlewareBuilder* tRPC, non un callable →
`TypeError: middleware is not a function`.

Il test dipendeva da un dettaglio interno di tRPC. Riscritto per esercitare il
middleware attraverso il proprio builder, così sopravvive agli upgrade di tRPC.

### RC-4 — Assert su `settings:read` per editor 🟢

`test/permissions.spec.ts` pretendeva `settings:read` nel ruolo editor. Il design
attuale è deliberato: `SECTION_ACCESS_DEFAULTS.editor.settings === false`, la
sezione settings è admin-only e `ROLE_PERMISSIONS.editor` non ha alcun grant
`settings:*`. Test stale. Invertito in asserzione negativa, così il vincolo di
design resta *bloccato* invece che semplicemente non testato.

### RC-5 — Test di integrazione senza database 🟢

Il resto dei fallimenti richiedeva un Postgres reale. Risolto separando unit da
integration, con container effimero (`docker-compose.test.yml`, porta 5434, `tmpfs`)
e service container in CI.

Lungo la strada sono emerse tre rotture da Prisma 7 negli helper:

- `datasources` **e** `datasourceUrl` rimossi dal costruttore: l'unico modo di
  puntare a un database specifico è il driver adapter (`PrismaPg`), lo stesso che
  usa `server.ts`. Un `new PrismaClient()` nudo non è più nemmeno costruibile.
- `migrate reset` accetta solo `--force/--schema/--config`; `--skip-seed` non esiste
  più. Sostituito con `migrate deploy`: idempotente e non distruttivo, sufficiente
  su un container che parte già vuoto.
- `prisma.config.ts` è ora la fonte dell'URL, letto da `DATABASE_URL`.

**Esito iniziale**: da 0 a **61 test di integrazione verdi**, con 97 rossi in
quarantena esplicita per drift di schema (`logoUrl`, `lastBrandId`, `isMain`,
`originalName`) e due moduli cancellati (`brandLogo.service`,
`permissions.service`).

**Esito finale**: quarantena **svuotata**, `184/184` su 16 file, job CI
`integration` non più `continue-on-error` — è bloccante. Il percorso e i difetti
di prodotto emersi lungo la strada sono in §5.

### RC-6 — Il codice di test non era typecheckato 🟢

`apps/api/tsconfig.json` ha `include: ["src/**/*"]`: la cartella `test/` non è mai
passata da `tsc`. È così che `datasources`, rimosso in Prisma 7, è sopravvissuto
negli helper senza segnalazioni.

Aggiunto `tsconfig.test.json` + task `typecheck:test`, in CI. Ha fatto emergere
subito 3 errori reali nel tier unit (mock logger incompleto, `UserSession` con campi
inesistenti, `mockResolvedValue()` senza argomento), tutti corretti.

### Nota di configurazione 🟢

`vitest` raccoglieva anche i `.js` compilati in `apps/api/dist/` come suite fantasma
a 0 test. Aggiunti `include`/`exclude` espliciti in `apps/api/vitest.config.ts`.

---

## 3. Interventi

### P0 — Rimettere in vita i test

- 🟢 `vitest.config.ts`: `include`/`exclude` espliciti, `dist/` fuori
- 🟢 Fix `@luke/core` (RC-1) — 87/87 verdi
- 🟢 Helper consolidati su un'unica fonte Postgres (RC-2); `test-db.ts` prima
  ridotto a re-export deprecato, poi eliminato (vedi §5)
- 🟢 Fix `permissions.spec.ts` e `sectionAccess.spec.ts` (RC-3, RC-4)
- 🟢 Fix `portafoglioSyncScheduler.test.ts`: mock `appConfig` mancante (il tick passa
  da `isMaintenanceActive`) e `runAllTimersAsync` su un `setInterval` ricorrente,
  che per definizione non termina → `advanceTimersByTimeAsync`
- 🟢 Split unit / integration via `test/integration-specs.ts`, lista unica condivisa
  dalle due config vitest
- 🟢 Script `test`, `test:integration`, `test:db:up/down` in root + wiring turbo
- 🟢 `typecheck:test` (RC-6)
- 🟢 Job `test`, `integration`, `migrations` in CI
- 🟢 `pre-push`: unit test (mai in `pre-commit` — troppo lento per il loop di lavoro)

**Stato a fine P0**: `pnpm test` → **259 test verdi** (172 api + 87 core).
**Stato oggi**: **322** (182 api + 77 core + 63 calendar) — il delta su `core` è
la rimozione di `hasPermissionWithGrants`, quello su `calendar` la copertura da
zero. `lint`, `typecheck`, `typecheck:test` verdi.

### P1 — Guard sulle migration

Il rischio non coperto: `schema.prisma` e `prisma/migrations/` possono divergere
senza che nulla lo dica, e il fallimento si manifesta al `migrate deploy` in
produzione dentro `entrypoint.sh`.

- 🟢 Job CI: Postgres vuoto → `migrate deploy` → `migrate diff --exit-code`
  (drift detection tra schema e migration)

### P2 — Skill `luke-*`

Cinque limiti strutturali dell'impianto attuale, tutti della stessa natura: le
skill producono *report*, non *sbarramenti*.

- 🟢 **Scoping sul diff.** Prima scandivano l'intero monorepo o un path. Ora
  accettano `--since <ref>` e default sul merge-base col branch di sviluppo:
  costo e rumore giù di un ordine di grandezza → si lanciano ad ogni sessione
  invece che "di tanto in tanto".
- 🟢 **Baseline di soppressione.** Gli audit LLM non sono deterministici: le stesse
  finding accettate riemergevano ad ogni run, alimentando l'abitudine a ignorarle.
  `.luke-audit-baseline.json` registra le finding accettate; le skill riportano solo
  ciò che è **nuovo**.
- 🟢 **Escalation obbligatoria a regola deterministica.** Ogni classe di finding che
  si ripete deve diventare regola semgrep o eslint, non essere ri-riportata. È la
  leva più alta dell'intero piano: converte token LLM in check gratuiti, ripetibili
  e permanenti.
- 🟢 **`lessons.md` come input.** Conteneva regressioni vere — inclusa quella che ha
  causato l'hotfix v1.9.1 (drift triplo `RATE_LIMIT_CONFIG` / `DEFAULTS` /
  `RateLimitConfigSchema`) — ma nessuna skill lo leggeva. Ora è input di check.
- 🟢 **Score di `luke-full` onesto.** La formula pesata su severità assegnate da LLM
  non è comparabile fra run. Ora è calcolato **solo sul delta rispetto alla baseline**.

### P3 — Skill `luke-test`

- 🟢 Nuova skill: dato il diff, genera/aggiorna i test del comportamento cambiato.
  Il vibe coding produce poco test — è il vuoto strutturale, non l'ennesimo audit.

### P4 — Gate di release 🟢

Un tag non fa scattare i trigger `push`/`pull_request`, quindi non esisteva alcuna
esecuzione di CI da cui far dipendere il build. Risolto rendendo `ci.yml`
invocabile (`workflow_call`) e aggiungendo un job `verify` in `release.yml` che la
richiama; `build-api` e `build-web` hanno `needs: verify`. Nessuna duplicazione di
step fra i due workflow.

### P5 — Smoke E2E 🟢

Il punto di partenza era peggiore di come l'avevo scritto: non "1 solo spec", ma
**zero spec funzionanti**. `tests/e2e/brands.spec.ts` e `tests/helpers/auth.ts`
sono interamente costruiti su `data-testid` — di cui `apps/web/src` contiene
**0 occorrenze** — e navigano a `/settings/brands`, rotta che non esiste (è
`/admin/brands`). Il login compila `input[name="email"]`, mentre la pagina ha un
campo `username`. Quella suite non è mai passata una volta.

Suite nuova in `apps/web/tests/smoke/`, costruita sul DOM reale con locator per
ruolo e label — nessun `data-testid` aggiunto all'applicazione:

| Spec | Cosa protegge |
| --- | --- |
| `auth.smoke.spec.ts` | login ok/ko, deep-link anonimo → `/login`, logout che non lascia sessione viva |
| `shell.smoke.spec.ts` | 8 rotte critiche: heading atteso, nessun error boundary, nessuna eccezione non gestita, nessuna 5xx — più la guardia contro la deriva della copertura (§5) |
| `brand-crud.smoke.spec.ts` | create → update → soft delete, più il P2002 sul codice duplicato |
| `pricing.smoke.spec.ts` | contesto → set parametri → `pricing.calculate` → numero a schermo |
| `calendar-freeze.smoke.spec.ts` | permessi, apertura picker, guardia sul "Continua" — **senza** eseguire il freeze |

Scelte che vale la pena ricordare:

- **`workers: 1` sempre**, non solo in CI. Vedi la nota sul rate limit più sotto.
- **Il freeze non viene eseguito.** Congelare un gruppo cambia lo stato della
  stagione e si annulla solo con un'azione admin: come effetto collaterale di uno
  smoke sarebbe peggio del bug che cerca. La mutation resta coperta dai test di
  integrazione su `seasonCalendar`.
- **`storageState` condiviso** da un progetto `smoke-setup`: un solo login per
  run, così un fallimento non è mai ambiguo fra flusso e autenticazione.
- **Il saluto giornaliero è soppresso** scrivendo il flag di `useDailyGreeting` in
  localStorage: è un `Dialog` a schermo intero che intercetta ogni click.
- La suite legacy è stata **eliminata** (`tests/e2e/brands.spec.ts`,
  `tests/helpers/auth.ts`, `tests/fixtures/README.md`).

Esito: **19/19 verdi** (`pnpm --filter @luke/web test:e2e`, 26s), database
verificato pulito a fine run. Vedi però la nota di ambiente in §5: con il budget
di rate limit esaurito la suite produce 429 intermittenti che sembrano bug
applicativi.

#### Due errori miei, entrambi istruttivi

**La pulizia taceva.** `cleanupSmokeBrands` aveva un `catch {}` muto e un
`count()` chiamato prima che la tabella finisse di caricare. `count()` — a
differenza di `expect` — non ritenta: leggeva 0 righe durante lo skeleton e
usciva convinta di aver finito. Per due run i test sono passati verdi lasciando
brand nel database, e me ne sono accorto solo interrogando Postgres. È
esattamente il difetto della suite legacy in miniatura: un test che sembra girare
e non gira. Ora il catch stampa, e il conteggio è preceduto da un'attesa
esplicita su "righe presenti oppure empty state".

**Concatenare più eliminazioni sul DOM vivo è instabile.** Fra AlertDialog che si
chiude, toast e invalidazione della lista, il click successivo trovava l'elemento
`not stable` o già staccato dal DOM. Verificato che **non è un problema
dell'applicazione**: a riposo la tabella brand è stabile e non emette una sola
query tRPC in 8 secondi. La pulizia riparte quindi da una navigazione a ogni
eliminazione — qualche centinaio di millisecondi in cambio del determinismo.

---

## 4. Escalation applicata — quattro regole

Il §3 del protocollo delle skill impone di promuovere ogni finding ricorrente a
regola deterministica. Applicato subito a quanto emerso qui:

- **`.semgrep/rules/prisma-client-instantiation.yml`** — vieta `new PrismaClient()`
  fuori da `server.ts` e dall'helper di test. È esattamente il drift che ha tenuto
  gli helper su SQLite per mesi. Esclusi gli script CLI one-shot, come per
  `luke-no-console`.
- **`.semgrep/rules/no-native-confirm.yml`** — vieta `globalThis.confirm` /
  `window.confirm` in `apps/web/src`. Regola presente in CLAUDE.md e finora non
  applicata da nulla. Codebase già pulita: la regola è preventiva.
- **`.semgrep/rules/fastify-plugin-leak.yml`** — vieta `app.register(...)` dentro
  un `fp()` sotto `apps/api/src/routes/**`. È il sesto difetto (§5): il rate
  limiter degli upload di logo diventato limite globale del server. Nessun file
  in `routes/` usa `decorate` o `addHook`, quindi nessuno ha bisogno di `fp()`.
- **`.semgrep/rules/trpc-middleware-before-input.yml`** — vieta
  `.use(withAuditLog(...))` / `.use(withIdempotency(...))` prima di `.input(...)`.
  Corretto a mano in 13 procedure su 5 router; nulla le teneva lì. Il difetto non
  produce errori né test rossi: svuota i metadati e basta.

Tutte e quattro agganciate a `pre-commit` (ERROR-tier), `security.yml` e
`security:sast`. Verificate: **0 findings su 651 file**.

**I gate non elencano più le regole una per una.** Aggiungerne una richiedeva tre
modifiche sincronizzate — `package.json`, `.husky/pre-commit`,
`security.yml` — e dimenticarne una la disattivava in silenzio in quel lane.
Ora tutti e tre usano `--config .semgrep/rules/ --severity ERROR`: la directory
intera, filtrata per severità. Una regola ERROR nuova entra da sola in tutti i
gate; `luke-mutation-requires-permission` resta WARNING e non bloccante perché il
filtro la esclude, senza doverla spostare. I ruleset community restano
un'invocazione separata e senza filtro, così non cambia cosa bloccano oggi.

---

## 5. Debito aperto e lacune note

Elenco onesto di ciò che resta scoperto, per non scambiare "verde" con "coperto".

**Integration in quarantena** 🟢 — chiusa. La lista in `tsconfig.test.json` è vuota
e il job CI `integration` è bloccante. Il principio seguito durante la riparazione:
mai riscrivere un'asserzione contro ciò che il codice fa *oggi* senza chiedersi
cosa *dovrebbe* fare — è così che si producono test tautologici, copertura senza
garanzia. Cinque volte la risposta è stata "il codice ha torto", e ne è uscito un
fix di prodotto.

**Recuperate (37 test verdi)**:

- `companyAccess.spec.ts` (7) — due test asserivano la **policy brand opposta** a
  quella vigente. Il commit 28b1873 è passato da "unione più permissiva" a opt-in
  stretto: `null` = nessun vincolo è ora riservato ad admin, e un team senza
  brandScopes non dà più accesso a tutti i brand. Riscritti, più il caso admin
  che non era coperto da nulla.
- `companyTeam.spec.ts` (6) — l'intero file testava il concetto di "main team"
  (`isMain`, main auto-creato, indice parziale), rimosso dallo stesso commit. Non
  riparabile: riscritto sugli invarianti attuali (unicità `(functionId, name)`,
  P2025→NOT_FOUND sul delete, semantica *replace* — non *append* — dei brandScopes
  in update, e `brandIds` omesso = non toccare).
- `companyStructure.rbac.spec.ts` (20) — `isMain` nelle fixture, e
  `company.function.deactivate` rinominata `delete`.
- `milestoneVisibility.integration.spec.ts` (4) — `CalendarMilestone` rinominato
  `CalendarEvent` (commit fbaa00f), con `MilestoneVisibility`→
  `CalendarEventVisibility` e `MilestoneUserVisibility`→`CalendarEventUserVisibility`.
  L'appartenenza non è più `ownerFunctionId` ma `planningGroupId`, obbligatorio:
  serve una fixture `PlanningGroup`.

**Difetto di lifecycle risolto** — era il vero blocco, non le singole spec.
`helpers/database.ts` eseguiva `prisma migrate deploy` (processo esterno, ~1s) ad
**ogni** `beforeEach` e chiamava `$disconnect()` ad ogni `afterEach` su un client
condiviso a livello di modulo: il pool veniva chiuso mentre altri riferimenti erano
ancora vivi, con `Cannot use a pool after calling end on the pool` a cascata.

Nuovo modello: un client per file di test (vitest isola i moduli per file), schema
applicato **solo se assente**, isolamento fra test via `TRUNCATE ... RESTART
IDENTITY CASCADE`, e un'unica disconnessione in `afterAll` globale
(`test/setup.ts`). `teardownTestDb()` resta come no-op perché invocata da molte
spec. Effetto collaterale gradito: la suite di integrazione passa da ~57s a ~27s.

**Altri drift risolti nello stesso passaggio**:

- `createCallerAs` / `createCallerWithIdempotency` / `createCallerWithIP` sono
  `async` (creano l'utente di test), ma 26 call site non facevano `await`: il
  caller era una Promise, e ogni `caller.users` risultava `undefined`.
- Policy password portata a **12 caratteri minimi**: tutte le fixture usavano
  ancora `Test123!` (8).
- `me.changePassword` richiede ora `confirmNewPassword`.

**Ancora rosse**, con causa identificata:

### Blocco Brand — risolto

`brand.spec.ts` **reimplementava il router localmente** (`testBrandRouter`) per
aggirare il rate limit. Una copia non è il codice di produzione: era rimasta
indietro su `logoUrl`→`logoKey`, sulle precondizioni di `hardDelete` e su
`UserPreference.lastBrandId` (oggi dentro il blob JSON `data`). Ora usa il
`brandRouter` reale, col rate limit neutralizzato azzerando lo store fra i test.

Perché la copia esisteva: i router reali usano `protectedProcedure`, che valida
`tokenVersion` contro la riga utente, e `createTestContext()` restituiva una
sessione finta (`id: 'test-user-id'`) → "Sessione scaduta" ad ogni chiamata. Ora
l'helper crea un utente **vero** del ruolo richiesto. Rimosso l'incentivo a
duplicare i router.

Test riscritti sul contratto attuale invece che su quello di due anni fa:
`limit` fuori da [1,100] rifiutato, codice brand limitato a `[A-Za-z0-9_-]` e 20
caratteri, nome max 128. Prima asserivano che input non validi venissero accettati.

**Bug di prodotto trovato e corretto** — `brand.create` fa check-then-act dentro
`$transaction`, ma PostgreSQL gira in READ COMMITTED: due create concorrenti sullo
stesso codice non si vedono a vicenda e arrivano entrambe all'insert. Il vincolo
unique impediva il duplicato, ma chi perdeva la corsa riceveva un errore Prisma
grezzo (500) invece del `CONFLICT` restituito a chi la perde per via del controllo
esplicito. Aggiunta la traduzione `P2002` → `CONFLICT` in
`apps/api/src/routers/brand.ts`, stesso pattern del `P2025` già usato in
`company.ts`. Il test di concorrenza era intermittente proprio per questo: ora
41/41 stabile su run ripetuti.

Anche `brand-logo-upload.integration` era rotto per ragioni strutturali: `require()`
dentro un modulo ESM, `supertest` puntato all'istanza Fastify invece che a
`app.server`, e — soprattutto — **il service sotto test era mockato**, quindi le
asserzioni su 400/404 non potevano essere soddisfatte: il mock ritornava successo
sempre. Ora si mocka solo lo storage sottostante e le validazioni reali girano.

### Suite logo — risolte

`logoUrl` non è un campo di database: è **derivato a runtime** dal router, che
risolve `logoKey` in URL pubblico. I test lo cercavano nelle righe Prisma. Inoltre
`MockStorageProvider.put` pretendeva una `key` in ingresso, mentre il vero
`putObject` la genera dal nome file — da cui `Invalid key: must be non-empty string`.

`moveTempLogoToBrand` non esiste più: il flusso temp→brand passa ora da un
fileObject *pending* confermato da `brandRouter.create`/`update` via `fileObjectId`.
I due test della funzione rimossa sono stati sostituiti da test del flusso reale,
inclusa la verifica che un `fileObjectId` inesistente non faccia fallire l'update
né sporchi `logoKey`.

### `ldap.resilience` — riscritta, e ha trovato un difetto di sicurezza

La suite mockava **`ldapjs`** con API a callback, ma il client è passato a
**`ldapts`** (API a promise). I mock puntavano a una libreria non più usata e
nessun test chiamava `connect()`: ogni operazione moriva su "LDAP client not
connected" senza mai esercitare retry o circuit breaker. Riscritta su `ldapts`, e
**spostata nel tier unit** — non tocca il database, non aveva motivo di stare fra
le suite di integrazione.

**Difetto trovato (aperto, richiede decisione)** — `bind()` converte
`InvalidCredentialsError` in `TRPCError UNAUTHORIZED`, ma `isNonRetryableError`
controlla `instanceof InvalidCredentialsError` e il messaggio contro pattern di
"invalid filter": il TRPCError non matcha nessuno dei due. Risultato: **una
password sbagliata viene ritentata `maxRetries + 1` volte**, quindi ogni login
errato colpisce Active Directory 3 volte. Con una lockout policy a 3-5 tentativi,
un solo typo può bloccare l'account.

Non corretto in questa sessione: tocca il percorso auth, che per CLAUDE.md richiede
approvazione esplicita. Il test fotografa il comportamento attuale con un commento
che lo marca come difetto — va portato a 1 chiamata quando viene sistemato.

### Ultimo giro — quattro difetti di prodotto trovati dai test riparati

**1. Seed rotto su installazione pulita** 🟢 — `prisma/seeds/companyStructure.ts`
usava ancora `isMain`, rimosso dallo schema: `pnpm db:seed` falliva. In più
`prisma/seed.ts` eseguiva il seed **al momento dell'import** (nessuna guardia
entrypoint), quindi importarne una funzione faceva partire tutto e il suo
`process.exit(1)` abbatteva il processo chiamante. Entrambi corretti e verificati
con un seed completo su database vuoto.

**2. `withAuditLog` prima di `.input()`** 🟢 — in 6 procedure il middleware era
concatenato prima della validazione, quindi riceveva `input` non ancora parsato:
**tutti gli audit log delle mutation utente perdevano i metadata di input**. Il
vincolo era già documentato nel codebase per `requirePermission`
(`src/lib/permissions.ts:55`), ma non applicato qui. Spostato dopo `.input()`.

**3. Rilevamento conflitti di idempotenza mai funzionante** 🟢 —
`src/lib/idempotencyTrpc.ts` calcolava l'hash del body da `ctx.input`, che **non
esiste** sul context tRPC: valeva sempre `undefined`, quindi il body era
costantemente `"{}"`. Conseguenza: una `Idempotency-Key` riusata per
un'operazione **diversa** non produceva il `CONFLICT` previsto — il client
riceveva in replay la risposta della prima richiesta, cioè l'entità sbagliata.
Corretto usando il parametro `input` del middleware, e riordinate le 7 procedure
che avevano `withIdempotency()` prima di `.input()`.

**4. Retry su credenziali LDAP invalide** 🟢 — vedi sezione `ldap.resilience`.
Corretto dopo approvazione esplicita.

Bonus: `expectToThrow` in `test/helpers.ts` lanciava il proprio errore "non ha
lanciato" **dentro** il `try`, dove il suo stesso `catch` lo intercettava e lo
riportava come "Expected error code 'X', got 'undefined'". Ogni test di questo
tipo dava quindi una diagnosi sbagliata: codice errore errato invece di "la
promise si è risolta". È ciò che ha nascosto il difetto #3.

Test riportati sul contratto reale: `users.list` esclude i `pendingApproval`
(quindi la verifica anti-duplicato va fatta sul database), `changePassword`
incrementa `tokenVersion` e revoca la sessione (il secondo submit **deve** essere
respinto — l'ordine auth → idempotency è corretto), gli "UUID v4 validi" erano
in realtà UUID v1.

### Quinto difetto: errori multipart mappati a 500

`brandLogo.routes.ts` trattava come guasto interno ogni errore del parser
multipart: body non multipart, boundary mancante, file oltre il limite. Un client
che sbagliava la richiesta riceveva un 500, senza indicazione della causa.
Aggiunta la distinzione — i codici `FST_*` di @fastify/multipart e gli errori
busboy senza `code` (`"Multipart: Boundary not found"`) ora danno 400. Sostituito
anche un `require('stream')` con un import statico.

Tre test di questo file misuravano l'harness invece del server: lo stream
"corrotto" faceva abortire il client (`ECONNRESET`) prima di qualsiasi risposta,
150 upload concorrenti saturavano il socket, e la suite dipendeva dall'ordine di
esecuzione perché creava un brand con codice fisso senza troncare i dati.

### Sesto difetto: il rate limit globale era quello degli upload di logo 🟢

Trovato dallo smoke E2E, che falliva a intermittenza con "Backend non
raggiungibile" — cioè 429 travestiti da backend giù.

`apps/api/src/routes/brandLogo.routes.ts` era wrappato in `fp()`.
`fastify-plugin` rompe l'incapsulamento **di proposito**: il rate limiter
registrato dentro quel file finiva nello scope root e diventava il limite
globale del server.

| | `server.ts:126` (inteso) | Limiter di brandLogo (effettivo) |
| --- | --- | --- |
| dev | max 2000 + allowList localhost | max 100, nessuna allowList |
| prod | max 100 per IP | **max 30 per utente** |

In produzione **ogni rotta** — batch tRPC inclusi — era limitata a 30 req/min per
utente invece di 100 per IP. Il docstring del file dichiarava "Rate-limited to 30
req/min per user" riferendosi ai suoi due endpoint di upload: l'intento era
chiaro, l'effetto no.

La diagnosi è stata più lunga del fix perché due segnali si contraddicevano:
`/api/health` riportava `environment: development` mentre il limite misurato
restava quello di produzione. Discriminante decisivo: **CORS rifletteva qualunque
`Origin` e mancava `strict-transport-security`** — entrambi rami dev di
`isDevelopment()`. Quindi la funzione era `true` alla registrazione, e il 100
poteva venire solo da un secondo limiter.

Misura prima e dopo, su 200 richieste a `/healthz`:

```
prima:  ok=100  rate-limited=40
dopo:   ok=200  rate-limited=0     (nessun header x-ratelimit: allowList attiva)
```

Fix: rimosso `fp()`, la funzione è ora un normale plugin incapsulato come i due
file gemelli `specsheetImage.routes.ts` e `collectionRowPicture.routes.ts`.
`companyLogo.routes.ts` e `seasonCalendarExport.routes.ts` usano ancora `fp()` ma
non registrano plugin, quindi sono innocui.

**Perché nessun test lo aveva preso**: un rate limit globale sbagliato non rompe
nessuna singola richiesta. Si vede solo con un carico realistico e sostenuto su
più rotte — che è precisamente ciò che una suite E2E produce e uno unit test no.

### Stato finale: verde

**Progressione**: 97 rossi iniziali → 73 → 43 → 32 → 24 → 9 → **0**.

```
Integration:  184/184  (16 file)
Unit:         182 api + 87 core + 63 calendar = 332
lint / typecheck / typecheck:test → verdi
```

La quarantena in `tsconfig.test.json` è **vuota**: ogni suite è coperta dal
typecheck. Il job CI `integration` non è più `continue-on-error` — è bloccante.

Lungo il percorso il typecheck sulle suite uscite di quarantena ha fatto emergere
altri errori, soprattutto mock di logger incompleti, ora centralizzati in
`test/helpers/logger.ts` (`createSilentLogger`).

`permissions-enforcement.integration.spec.ts` è stata **eliminata**: testava il
sistema di grants per-utente, rimosso dal commit 3d6f396.

Nello stesso giro è stato rimosso anche `hasPermissionWithGrants` 🟢, l'ultimo
residuo di quel sistema. Il commit 3d6f396 (2026-03-18) aveva droppato i modelli
Prisma `UserGrantedPermission` e `PermissionAudit` con la relativa migration; la
funzione era sopravvissuta, esportata dalla superficie pubblica di `@luke/core`
(`export * from './auth/permissions'`), con ~25 asserzioni tutte sue — verdi, su
array costruiti a mano che **nessun percorso di codice poteva più produrre**.
Rimossi funzione e test: `@luke/core` è workspace-only, nessun consumer esterno.
`packages/core` passa da 87 a 77 test.

**`@luke/calendar`** 🟢 — era l'unico pacchetto con zero test. Ora ne ha **63**,
concentrati dove un errore è invisibile da dentro Luke e visibile solo sui
calendari degli utenti:

- `computeContentHash` — un test di sensibilità per ogni campo che influenza
  l'evento. Un campo escluso dall'hash significa aggiornamenti silenziosamente
  saltati; l'indipendenza dall'ordine di `visibilityFunctionIds` evita invece
  riscritture inutili ad ogni sync.
- `syncMilestone` — creazione, skip su hash uguale, update in place (non un
  secondo evento), cancellazione su `publishExternally=false`, rimozione dei
  mapping per function non più visibili, e la politica di retry (4xx no, 429 sì).
- ACL — riconciliazione lettori (aggiunge/rimuove/svuota), idempotenza sul 404,
  e `enforceDomainReadOnly`, che impedisce alla regola di dominio auto-creata da
  Google di scavalcare i permessi per utente.
- iCal ed eventi Google — UID stabile, all-day come data pura (un all-day inviato
  come dateTime si sposta di giorno fuori UTC), default di `endAt`, mappatura
  cancelled → CANCELLED.

Il giro ha chiuso anche un buco di tooling: `packages/core` e `packages/calendar`
escludevano `__tests__` dal tsconfig **di build**, quindi `tsc --noEmit` non
controllava affatto il codice di test. Aggiunti `tsconfig.test.json` e
`typecheck:test` a entrambi — e il primo run ha subito trovato in
`core/src/auth/__tests__/permissions.test.ts` un `import type { Role } from '../rbac'`
che punta a un file inesistente: essendo type-only veniva strippato da vitest e
non aveva mai dato errore.

**Script CLI rotti sotto Prisma 7** 🟢 — usavano `datasources` o `new PrismaClient()`
nudo, entrambi non più supportati: fallivano all'avvio. Risolto con la factory
condivisa `apps/api/scripts/lib/prisma.ts`, che costruisce il client col driver
adapter come fa `src/server.ts`. Aggiornati `nav-reset.ts`, `dev-bootstrap.ts`,
`fix-allday-event-dates.ts`, `harden-google-calendar-acl.ts`,
`migrate-collection-layout.ts`. `prisma/seed.ts` e
`prisma/migrate-sqlite-to-postgres.ts` usavano già l'adapter.

La regola semgrep `prisma-client-instantiation` è stata ristretta di conseguenza:
ora le uniche sedi legittime sono `src/server.ts`, `test/helpers/database.ts`,
`scripts/lib/prisma.ts` e `prisma/**`.

**Due script di migrazione morti** 🟢 — `prisma/migrate-sqlite-to-postgres.ts` e
`scripts/migrate-collection-layout.ts` erano one-shot già eseguiti, fermi a modelli
che non esistono più (`userBrandAccess`, `userSeasonAccess`,
`CollectionLayoutRow.progress`). Non riparabili in modo sensato: migravano DA uno
schema dismesso. **Eliminati**, e con loro le rispettive esclusioni dal typecheck —
non resta codice tenuto fuori dai controlli.

**`apps/api/test/helpers/test-db.ts`** 🟢 — **eliminato**. L'unico consumer è stato
ripuntato su `./helpers`. Con lui è sparita `hasTestDatabase()`: nessuna spec la
chiamava, e il pattern `describe.skipIf` che il suo docstring suggeriva avrebbe
fatto riportare verde il job integration con **zero test eseguiti** quando
`TEST_DATABASE_URL` manca. Ora in quel caso le suite falliscono, che è il
comportamento corretto.

**Tre file `.disabled` tracciati in git** 🟢 — `bootstrap.seed.spec.ts.disabled`,
`ldap-config.spec.ts.disabled`, `ldap-config-simple.spec.ts.disabled`, datati
ottobre 2025: copie quasi identiche degli spec ora vivi, invisibili a vitest,
`tsc` ed eslint per via dell'estensione. Eliminati.

**La lista degli integration spec** 🟢 — `test/integration-specs.ts` è stato
**eliminato** a favore della convenzione `*.integration.spec.ts`, già seguita da
5 file su 16. Rinominati gli altri 11; le due config vitest ora fanno
`include`/`exclude` sul glob. Un elenco a mano ha un fallimento asimmetrico: una
voce *mancante* si nota subito, una voce *stale* dopo una rinomina no — vitest
non protesta finché almeno un file corrisponde, così una suite può uscire
silenziosamente dalla run.

Nella rinomina i tre spec brand-logo si sono rivelati mal nominati: due
collidevano sullo stesso nome (`brand-logo-upload.spec.ts` e
`brand-logo-upload.integration.spec.ts`) pur testando cose diverse. Rinominati su
ciò che coprono: `brandLogo.service`, `brandLogo.routes`, `brandLogo.validation`.

**Lint e typecheck ora coprono `test/` e `scripts/`** 🟢 — `eslint.config.mjs`
include le due directory, `apps/api` linta `src/ test/ scripts/`, e
`tsconfig.test.json` typechecka anche `scripts/` e `prisma/`. Emersi e corretti
100 problemi di lint (82 auto-fix, il resto variabili morte nelle spec in
quarantena, prefissate `_` in attesa della riscrittura).

**Copertura rotte dello smoke: ora è una decisione, non una dimenticanza** 🟢 —
`CRITICAL_ROUTES` copre 8 delle 33 rotte statiche del gruppo `(app)`. Il problema
non era il numero, era che le altre 25 stavano fuori *in silenzio* e una pagina
nuova le raggiungeva senza che nessuno lo notasse — lo stesso meccanismo per cui
la suite E2E precedente è rimasta rotta per mesi. Aggiunto un test che enumera
`src/app/(app)/**/page.tsx` e pretende che ogni rotta sia in `CRITICAL_ROUTES`
oppure in `UNCOVERED_ROUTES` **con un motivo scritto**. Verifica anche il
contrario: una voce che non corrisponde più a una pagina finge copertura decisa su
qualcosa che non esiste. Controllato che la guardia non sia vacua — togliendo una
voce fallisce e nomina la rotta.

**Setup CI duplicato in quattro job** 🟢 — checkout, pnpm, Node, install e
`prisma generate` erano ripetuti identici: un bump di Node andava fatto in quattro
punti, e dimenticarne uno faceva girare un job su una versione diversa senza
segnalazione. Estratti in `.github/actions/setup-workspace`. Il job `test` è stato
accorpato in `checks`: condivide esattamente lo stesso ambiente, non serve
database, e `pnpm test` è cache-turbo — un secondo setup completo per quel
parallelismo non si ripaga. `integration` e `migrations` restano separati: servizi
Postgres e variabili diverse.

**Lo smoke non è in CI** — richiede stack applicativo + DB seedato in piedi. È un
gate pre-release manuale, non un check per push. Portarlo in CI vuol dire
compose con API + web + Postgres nel workflow: fattibile, non fatto.

### Nota di ambiente — `NODE_ENV` non impostata in dev 🟢

`apps/api/.env` conteneva **solo** `DATABASE_URL`, e lo script dev è
`tsx watch --env-file=.env src/server.ts`: `NODE_ENV` non veniva mai impostata,
quindi `isDevelopment()` (`process.env.NODE_ENV === 'development'`) era **false**
anche in sviluppo. L'API locale girava con la postura di produzione: CSP e HSTS
attivi, e il rate limit senza l'allowList per localhost che `server.ts` ha
scritto apposta "to avoid dev friction".

Aggiunta la riga `NODE_ENV=development` a `apps/api/.env` (ammessa esplicitamente
dalla env policy). Attenzione: **non basta il reload di `tsx watch`** —
`--env-file` viene letto dal processo supervisore al proprio avvio, quindi serve
fermare e rilanciare `pnpm dev`.

Questo però era solo la metà del problema: anche con `NODE_ENV=development`
attivo il limite restava quello di produzione, perché il limite globale non era
quello di `server.ts`. Vedi **"Sesto difetto"** più sopra in questo stesso §5
(`fp()` in `brandLogo.routes.ts`). Le due cause insieme spiegano i 429 in
sviluppo; la prima da sola no.

Nota collaterale utile a chi progetta suite E2E: con la sola applicazione aperta,
heartbeat e polling notifiche consumano ~70 req/min. Sotto un limite da 100 resta
pochissimo margine per i test — motivo per cui lo smoke gira con `workers: 1` e
`global-setup.ts` fa un probe che distingue backend giù, 429 e healthcheck rosso
invece di lasciar arrivare l'errore travestito da login fallito.

---

## 6. Secondo giro (2026-07-30) — il tooling controllato con lo stesso metro

L'assessment del primo giro guardava il codice. Questo guarda **gli strumenti che
lo controllano**, con lo stesso criterio: non "il controllo esiste" ma "il
controllo fallisce quando deve". Ne sono usciti sei residui della stessa classe.

### `.claude/` non era versionato 🟢

Il tooling che fa rispettare `CLAUDE.md` — 8 skill, l'hook git, i settings
condivisi — viveva su una sola macchina, non revisionabile e senza backup.
Ora tracciato (13 file).

Il fix ovvio sarebbe stato inerte: `.gitignore` conteneva `.claude/`, e **una
directory esclusa non viene percorsa da git**, quindi nessun `!.claude/skills/**`
sotto di essa può riammettere alcunché. Serve escludere il contenuto un livello
sotto (`.claude/*`), perché `*` non matcha `/`. Vedi `lessons.md`.

### Il fan-out a 3 agenti non è mai girato 🟢

`luke-audit`, `luke-bugs` e `luke-security` dichiarano `agent: Explore` e
contenevano "Run 3 agents in parallel". **Explore non ha il tool Agent**: ogni
report `luke-*` mai letto è stato prodotto da un passaggio singolo e sequenziale.
Un fan-out dichiarato e mai avvenuto, dentro le skill il cui scopo è trovare
esattamente questo.

Rimosso, non riparato: passare a `general-purpose` per sbloccare i subagenti
avrebbe consegnato Write ed Edit a delle skill read-only, degradando un
invariante strutturale (il tipo di agente) a un'istruzione in prosa. Regola e
motivazione in `.claude/skills/luke-shared/audit-protocol.md` §6, verificata in CI.

### `luke-test` insegnava una struttura eliminata 🟢

Istruiva ad aggiungere ogni nuova spec a `test/integration-specs.ts` (file
cancellato in questo stesso piano) e a usare `hasTestDatabase()` (rimossa proprio
perché il pattern che abilitava faceva riportare verde il job con zero test).

La riscrittura non aggiorna l'inventario degli helper: lo **cancella**. Era
driftato perché duplicava la codebase, e il rimedio a una duplicazione non è una
duplicazione più fresca — ora punta al barrel, che non può marcire.

### Due `createTestContext` incompatibili 🟢

`test/helpers.ts` ne esportava uno sincrono che prende una `UserSession` e non
tocca il database; `test/helpers/testContext.ts` uno asincrono che prende un
`Role`, crea un utente vero e tronca i dati. Stesso nome, semantiche opposte,
scelta per import — 4 spec usavano l'uno, 3 l'altro, e uno dei call site era un
import dinamico invisibile al grep.

L'async è ora `createContextForRole`. Ma il fix durevole è il barrel: `helpers.ts`
ri-esporta esplicitamente i moduli `helpers/`, così due omonimi diventano
**TS2323 in compilazione**. Verificato reintroducendo la collisione.

### Gate di copertura delle procedure tRPC 🟢

35 file router su 46 non erano raggiunti da alcun test, e niente segnalava
l'arrivo del 36°.

Misura reale, non dichiarata: un `Proxy` su ogni voce di
`appRouter._def.procedures` registra le invocazioni effettive; solo lo *scoperto*
è dichiarato, in `test/procedure-coverage.ts`, per namespace e con un conteggio
che il gate verifica. Una lista di procedure "coperte" scritta a mano sarebbe
stata un'affermazione che nessuno verifica — il difetto di questo piano
reintrodotto dal suo stesso fix.

**Stato misurato: 28 procedure invocate su 309, il 9%.** Il numero è in chiaro
nel file: è la misura, non un traguardo.

Il gate vive dentro `pnpm test:integration` (un `globalSetup`, non uno step CI
che si può dimenticare) e l'escape per le run parziali è **derivato** dal
confronto fra spec eseguite e spec su disco, non da una variabile d'ambiente da
impostare e dimenticare accesa.

Ha trovato due difetti al primo colpo:

- `brand.integration.spec.ts` usava `brandRouter.createCaller`, ma
  `router({ brand: brandRouter })` non conserva il sotto-router — il test
  esercitava un percorso che la produzione non prende. Riscritto su
  `appRouter.createCaller(ctx).brand`: 7/7 non invocate → 3.
- La prima stesura del `globalSetup` importava `appRouter` per transitività e
  lasciava il processo appeso ("close timed out"). Moduli separati.

### Skill e docs: i fatti che affermano ora sono bloccanti 🟢

`pnpm check:drift`, nel job `checks`:

- `check-skill-integrity.ts` — path e simboli citati dalle skill devono
  esistere; una skill `agent: Explore` non può contenere istruzioni di fan-out.
- `check-docs-integrity.ts` — marker `luke-docs:start/end` appaiati, link
  relativi che risolvono. Sostituisce la Phase 3 di `luke-docs`: era parsing
  affidato a un LLM, livello 4 dove ne basta uno di livello 2.

Entrambi hanno una guardia zero-discovery che lancia se l'euristica smette di
matchare — la lezione della lista di tabelle memoizzata vuota, applicata a una
regex.

### `pnpm test:integration` non partiva in locale, e non era scritto da nessuna parte 🟢

`TEST_DATABASE_URL` non è impostata da nulla in locale: in CI arriva dall'env del
job, e `pnpm test:db:up` avvia solo il container. Il comando falliva quindi
sempre, con l'header di `docker-compose.test.yml` che suggeriva il contrario
(«`pnpm test:db:up` avvia · `pnpm test:integration` esegue le suite»).

Il **fallimento è corretto** e va tenuto — una suite che salta quando manca il
database è come si ottiene un job verde con zero test eseguiti. Mancava il
comando per evitarlo:

```bash
pnpm test:db:up
TEST_DATABASE_URL="postgresql://luke:luke_test@localhost:5434/luke_test" \
  pnpm test:integration
```

Documentato in `docker-compose.test.yml` (con i valori, che vengono da lì) e in
`.claude/skills/luke-test/SKILL.md`. `turbo.json` dichiara già
`env: ["TEST_DATABASE_URL"]` sul task, quindi la variabile attraversa turbo:
verificato, 187/187 dalla root.

### Metodo

Nessun gate di questo giro è stato considerato fatto prima di **averlo visto
fallire**: conteggio alterato, run parziale in CI, procedura nuova non
dichiarata, path inesistente in una skill, fan-out reintrodotto, link rotto,
marker sbilanciato, e la collisione di nomi rimessa apposta. Sette controprove,
tutte rosse quando dovevano.

### Resta fuori, per scelta

- **Smoke Playwright in CI** — non gira in nessun workflow. Deciso di lasciarlo
  come gate pre-release manuale.
- **Regola eslint sugli import profondi in `test/`** — prevista dal piano, non
  applicata: ci sono 21 import `./helpers/*` in 14 spec, e vietarli avrebbe
  significato riscriverli tutti per un guadagno marginale. È il **barrel** a
  produrre l'errore di compilazione, non il path di import delle spec.
- **Estrazione del catalogo env** da `server.ts` — tocca il path di boot e
  un'esclusione semgrep ERROR-tier, per un valore basso.

---

## 7. Principio di fondo

L'analisi statica dice *com'è scritto* il codice. I test dicono *cosa fa*. Le skill
LLM trovano ciò che nessuna regola sa ancora esprimere — e il loro output migliore
non è un report, è **una regola nuova** che rende quel report inutile la volta dopo.

Ordine di preferenza per ogni controllo, dal più forte al più debole:

1. Impossibile da sbagliare (tipi, schema, vincoli DB)
2. Bloccato automaticamente (eslint, semgrep, test in CI)
3. Segnalato deterministicamente (drift check, osv)
4. Trovato da un LLM (skill `luke-*`) → **da promuovere a livello 2 appena si ripete**
