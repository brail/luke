---
name: luke-test
description: >
  Generates and updates tests for the Luke monorepo based on what actually
  changed. Picks the right tier (unit vs integration), the right helpers, and
  writes assertions on invariants rather than on snapshots of current behavior.
  Use after implementing a feature or fixing a bug, before committing.
  Scoping: default = diff vs merge-base. /luke-test apps/api | --since <ref>
---

# Luke Test Writer

Scrive e aggiorna i test per il codice cambiato. A differenza delle skill di audit,
questa **modifica file** — ma solo file di test, mai codice applicativo.

Se durante il lavoro emerge che il codice sotto test ha un bug, **non correggerlo**:
segnalalo e scrivi il test che lo espone, marcandolo `.fails` o `.todo` con un
commento che spiega perché. La decisione se cambiare il comportamento è dell'utente.

**Leggi per primo `.claude/skills/luke-shared/audit-protocol.md` §1** per risolvere
lo scope. Default: diff vs merge-base.

---

## 1. Mappa dei tier

Il progetto ha tre tier. Sbagliare tier è l'errore più costoso: un test unit che
tocca il database finisce nel progetto sbagliato e fallisce in CI.

| Tier | Membership | Config |
|---|---|---|
| **Unit** | tutto ciò che **non** matcha `*.integration.spec.ts` | `apps/api/vitest.config.ts` |
| **Integration** | `apps/api/test/**/*.integration.spec.ts` | `apps/api/vitest.integration.config.ts` |
| **Smoke E2E** | `apps/web/tests/smoke/*.smoke.spec.ts` | `apps/web/playwright.config.ts` |

La membership è **il nome del file**, non un elenco. C'era una lista a mano
(`test/integration-specs.ts`), eliminata: un elenco ha un fallimento asimmetrico, <!-- skill-check-ignore -->
una voce mancante si nota subito ma una voce stale dopo una rinomina no, e una
suite può uscire dalla run in silenzio.

Regola di scelta: **serve una tabella Prisma reale?**

- No → unit. Mocka `ctx.prisma` con i soli metodi usati.
- Sì → integration: chiama il file `<nome>.integration.spec.ts` e sei dentro.

Comandi:

```bash
pnpm test                          # unit
pnpm test:integration:local        # integration: avvia il container e passa TEST_DATABASE_URL
pnpm --filter @luke/web test:e2e   # smoke, con lo stack applicativo in piedi
```

Senza `TEST_DATABASE_URL` la suite **fallisce**, non salta: è voluto — un job
verde con zero test eseguiti è peggio di un job rosso. Valori e forma esplicita
in `docker-compose.test.yml`.

**Copertura delle procedure**: la suite di integrazione ha un gate che verifica
quali procedure tRPC vengono *invocate davvero* (`test/procedure-coverage.ts`).
Se aggiungi una procedura senza test, `pnpm test:integration` fallisce e ti
stampa la voce da incollare. Non aggirarlo dichiarandola scoperta senza motivo:
il gate rifiuta i motivi segnaposto.

---

## 2. Helper esistenti — usa questi, non reinventarli

**`apps/api/test/helpers.ts` è il barrel unico: la sua lista di export *è* l'API
di test. Leggila lì.**

Questa sezione elencava le firme una per una ed è driftata: citava
`hasTestDatabase()` mesi dopo la sua rimozione e `teardownTestDb(prisma)` dopo che <!-- skill-check-ignore -->
il parametro era sparito. Duplicava la codebase, e una duplicazione marcisce
sempre. Il rimedio non è una duplicazione più fresca.

I moduli sotto `test/helpers/` (`database`, `logger`, `testContext`,
`storageTestHelper`) sono tutti ri-esportati dal barrel — anche perché è quella
ri-esportazione a far collidere i nomi omonimi in fase di compilazione. Se
aggiungi un export a un modulo helper, aggiungilo anche al barrel.

Le tre regole che dal codice **non** si desumono:

1. **Mai `new PrismaClient()` diretto**: in Prisma 7 il costruttore non accetta un
   URL, serve l'adapter — e un client senza adapter punta al database di sviluppo.
2. **`TEST_DATABASE_URL` mancante = la suite fallisce, mai skip.** `describe.skipIf`
   sulla disponibilità del database è vietato: fa riportare verde il job con zero
   test eseguiti, che è peggio di un job rosso. È il motivo per cui
   `hasTestDatabase()` è stata rimossa invece che riparata. <!-- skill-check-ignore -->
3. **Nessun hook di teardown del database.** La disconnessione avviene una volta
   per file, nel setup globale (`test/setup.ts`), e l'isolamento è per
   troncamento. `teardownTestDb()` era il no-op che sopravviveva ai propri <!-- skill-check-ignore -->
   chiamanti: è stato rimosso insieme a loro. Non reintrodurlo.

---

## 3. Regole di scrittura

Nascono tutte da rotture reali già avvenute in questo progetto.

### 3.1 Asserisci invarianti, non numeri

Un conteggio hardcodato è una bomba a orologeria: si rompe all'aggiunta di una
azione, e il fallimento sembra una regressione quando è solo un test vecchio.

```ts
// ✗ si rompe appena `audit` guadagna un'azione
expect(auditPerms.length).toBe(2);

// ✓ deriva dalla fonte di verità
for (const [resource, actions] of Object.entries(VALID_RESOURCE_ACTIONS)) {
  expect(permissions.filter(p => p.startsWith(`${resource}:`)).length)
    .toBe(actions.length + 1);
}
```

### 3.2 Passa dal surface pubblico, non dagli internals

I middleware tRPC (`requirePermission`, `withSectionAccess`) ritornano un
`MiddlewareBuilder`, non una funzione invocabile. Testali attraverso una procedura
reale — è il percorso di produzione e sopravvive agli upgrade di tRPC.

```ts
const probeRouter = router({
  probe: publicProcedure.use(requirePermission('brands:create')).query(() => 'ok'),
});
await expect(probeRouter.createCaller(ctx).probe()).resolves.toBe('ok');
```

### 3.3 I mock devono essere completi quanto il percorso testato

Un mock parziale non fa fallire il test: lo fa fallire **per la ragione sbagliata**.
Un `logger: {}` ha trasformato un `FORBIDDEN` atteso in `INTERNAL_SERVER_ERROR`,
mascherando cosa stesse davvero succedendo.

Prima di scrivere un mock, segui il percorso di esecuzione e includi **ogni**
metodo che verrà toccato — inclusi quelli dei middleware attraversati
(`ctx.logger`, `ctx.prisma.appConfig` per `getRbacConfig`, ecc.).

### 3.4 Timer ricorrenti: mai `runAllTimersAsync`

Su uno scheduler con `setInterval`, "esegui tutti i timer" non termina per
definizione — vitest aborta dopo 10.000 iterazioni.

```ts
// ✗ loop infinito
vi.advanceTimersByTime(60_000);
await vi.runAllTimersAsync();

// ✓
await vi.advanceTimersByTimeAsync(60_000);
```

### 3.5 Mai test tautologici

Un test che asserisce «il codice fa quello che il codice fa», scritto leggendo
l'implementazione, dà copertura senza dare garanzie — ed è peggio di nessun test,
perché sembra protezione.

Prima di ogni asserzione, chiediti: **quale bug plausibile farebbe fallire questo
test?** Se non sai rispondere, non scriverlo. Deriva l'atteso dal contratto (schema
Zod, tipo, regola in CLAUDE.md, comportamento richiesto), non dal corpo della funzione.

---

## 4. Cosa testare per tipo di modifica

| Cambiamento | Test minimo richiesto |
|---|---|
| Nuova procedura tRPC | Permesso concesso/negato per admin, editor, viewer, anonimo |
| Nuovo campo su schema Zod | Input valido accettato, input invalido rifiutato con il messaggio giusto |
| Nuova regola RBAC / sezione | Le tre fonti (`sectionEnum`, `SECTION_TO_PERMISSION`, `SECTION_ACCESS_DEFAULTS`) restano in sync |
| Mutation | `withAuditLog`/`logAudit` produce la riga di audit attesa |
| Write multi-tabella | Il rollback della transaction lascia lo stato consistente |
| Nuova route rate-limited | Presente in `RATE_LIMIT_CONFIG`, `DEFAULTS` e `RateLimitConfigSchema` (vedi `lessons.md`) |
| Bug fix | Il test fallisce sul codice pre-fix — verificalo davvero, non assumerlo |

---

## 5. Output

1. Test scritti o aggiornati, con i percorsi.
2. Esito reale di `pnpm test` (e `pnpm test:integration` se toccato). Riporta
   l'output, non una parafrasi.
3. Se il gate di copertura ha chiesto di aggiornare `test/procedure-coverage.ts`,
   dillo e mostra la voce cambiata.
4. Cosa **non** hai coperto e perché — un elenco onesto vale più di una copertura
   gonfiata.
