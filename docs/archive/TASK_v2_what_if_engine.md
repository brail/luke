# TASK v2 — What‑If Engine + Domain Integration (RC 1.9.0)

## Istruzioni preliminari obbligatorie

> **Leggi CLAUDE.md, lessons.md e TASK_season_calendar.md prima di qualsiasi altra cosa.**
> Questo task **estende** la V1 del Season Calendar (già implementata). Non riscrive nulla che esiste già — verifica sempre cosa c'è prima di toccarlo.
> Le convenzioni, i pattern architetturali e i lesson learned in CLAUDE.md hanno **precedenza assoluta**.
> In caso di conflitto tra questo documento e CLAUDE.md / lessons.md, **vinci CLAUDE.md**.

> **Riferimento estetico/UX**: Collection Layout (non Merchandising Plan, ancora prototipale).

> **Continuità con V1**: tutti i pattern di V1 (RBAC brand, sezioni `planning.*`, sync Google, route `/[locale]/calendar`, multi‑brand, persistenza filtri) restano invariati. Questo TASK aggiunge livelli sopra, non li sostituisce.

---

## Obiettivo

Trasformare il Season Calendar da **registratore di date** a **orchestratore di processo stagionale**. Tre capacità nuove:

1. **What‑if engine** — un solver deterministico che, dato uno shift di milestone, identifica violazioni di vincoli (precedenze, gap, festività geo‑rilevanti) e propone una risoluzione minima a cascata.
2. **Domain integration** — milestone che fanno **transitare lo stato** di entità di dominio (Collection Layout, Merchandising Plan se presente), e che possono essere **ancorate** a sottoinsiemi di righe CL / SKU MP.
3. **UX di simulazione** — timeline interattiva con drag‑and‑drop, conflict detection real‑time, comando "Suggerisci risoluzione" che propone uno scenario alternativo accettabile/rifiutabile.

Tutto su grafo di sole milestone (le entità di dominio sono outcome, non nodi). Tutto deterministico (niente LLM nel solver). Tutto in modulo puro testabile.

---

## Decisioni architetturali (fissate, da non rimettere in discussione)

### D9. Grafo di sole milestone, entità di dominio come outcome

I nodi del grafo sono solo `CalendarMilestone`. CL, MP, SKU, trasferte non sono nodi: sono **outcome** (state effects) e **anchor** (entità referenziate dalla milestone). Questo tiene il grafo piccolo, calcolabile, comprensibile.

### D10. Tipo di arco unico: `MilestoneDependency`

Un solo tipo di arco con `minGapDays?` e `maxGapDays?` opzionali. La pura precedenza ("B dopo A") è `minGapDays = 0`. Le finestre obbligatorie sono `maxGapDays`. Niente proliferazione di enum di tipo arco.

### D11. Severity sui template, immutabile

La severity (`HARD | SOFT`) di una dipendenza è definita sul `MilestoneTemplateDependency` e si propaga immutata sull'istanza `MilestoneDependency` del calendario. **Non** modificabile a posteriori. Per archi custom non ereditati da template, la severity va specificata al momento della creazione e poi diventa anch'essa immutabile.

### D12. Override delle dipendenze a livello calendario

Sul calendario specifico l'utente può:

- Modificare `minGapDays` / `maxGapDays` di un arco ereditato
- **Disabilitare** un arco ereditato (flag, non eliminazione, per preservare lineage)
- Aggiungere archi **custom** (con severity esplicita al momento della creazione)
- **Non** modificare la severity di nessun arco

### D13. Solver deterministico, modulo puro

Il what‑if engine è un modulo `packages/calendar/src/solver/` di **pure functions** (no IO, no DB, no chiamate esterne). Forward propagation greedy con detection di overconstrained. **Niente LLM**: planning richiede determinismo ed explainability che un LLM non garantisce.

### D14. State effects whitelistati e configurabili per‑transizione

Ogni state effect è tipizzato da un enum chiuso (whitelist). Non si scrive codice arbitrario nelle milestone. Ogni effect dichiara individualmente `requiresConfirmation: boolean`, deciso a livello di template. Reversibilità garantita tramite snapshot dello stato precedente (`previousStateSnapshot`).

### D15. Sandbox what‑if = client‑only in V2

Il "gioco" (drag, simulazione, suggest, accept/discard) vive in stato React lato client durante la sessione. Niente `WhatIfSession` server‑side persistente in V2 (rinviato a V3 per scenari condivisibili e confronti A/B).

### D16. Festività via seed statico, no API live

I dati di festività sono in un file YAML versionato in `apps/api/prisma/seeds/holidays/` per i paesi rilevanti FEBOS (IT, CN, VN, IN, TR come baseline). Aggiornamento manuale annuale. **No** chiamate live a nager.at o API simili: una dipendenza esterna in fase di pianificazione stagionale è un rischio sproporzionato per il valore aggiunto.

---

## Regole trasversali

- **Non duplicare modelli di V1.** Estendi `CalendarMilestone` con nuovi campi (`severity`, `relevantCountries`); non creare un secondo modello.
- **Solver = pure functions.** Nessun import di Prisma, fastify, react o googleapis nel modulo solver. Solo input → output.
- **State effects = whitelist.** Mai stringhe libere o eval. Enum chiuso, mappa enum→handler in TypeScript.
- **Reversibilità degli state effects è obbligatoria** per i tipi che modificano stato di entità. Snapshot in DB del valore precedente.
- **MP integration condizionale**: se Merchandising Plan non è ancora implementato in codebase, gli state effects MP sono **omessi** dalla whitelist con un commento `// TODO: enable when MP is implemented`. **Verificare** per primo.
- **Festività non sono milestone.** Non vanno in `CalendarMilestone`. Sono un dominio separato che il solver consulta.
- **Audit log obbligatorio** per: modifica dipendenze, esecuzione state effects, rollback state effects.

---

## Fase 1 — packages/core

### 1.1 Schemi Zod — estensione `seasonCalendar.ts`

**Verificare** il file esistente prima di toccarlo. Aggiungere:

```ts
export const DEPENDENCY_SEVERITY = ['HARD', 'SOFT'] as const;
export const MILESTONE_SEVERITY = ['CRITICAL', 'NORMAL', 'INFO'] as const;

// ISO‑3166‑1 alpha‑2; whitelist iniziale ma estendibile
export const RELEVANT_COUNTRY_CODES = ['IT', 'CN', 'VN', 'IN', 'TR'] as const;

// State effect types — whitelist chiusa
export const STATE_EFFECT_TYPE = [
  'LOCK_COLLECTION_LAYOUT',
  'UNLOCK_COLLECTION_LAYOUT',
  // 'CONFIRM_MERCHANDISING_PLAN',  // abilita solo se MP esiste
  // 'UNCONFIRM_MERCHANDISING_PLAN',
] as const;
```

**Schema input dipendenza** `MilestoneDependencyInputSchema`:

- `predecessorId`, `successorId` (devono essere distinti, refine)
- `minGapDays?: number` (>= 0)
- `maxGapDays?: number` (>= minGapDays se entrambi presenti)
- `severity` (enum, obbligatorio se l'arco è custom; ereditato dal template altrimenti)
- `reason?: string` (max 500 char)

**Schema input state effect** `MilestoneStateEffectInputSchema`:

- `effectType` (enum `STATE_EFFECT_TYPE`)
- `targetEntityType` (enum: 'COLLECTION_LAYOUT' | 'MERCHANDISING_PLAN')
- `targetEntityId: string`
- `requiresConfirmation: boolean`

**Schema input anchor** `MilestoneAnchorInputSchema`:

- `entityType` (enum: 'COLLECTION_LAYOUT' | 'COLLECTION_LAYOUT_ROW' | 'MERCHANDISING_PLAN' | 'MERCHANDISING_PLAN_SKU')
- `entityId: string`

**Estensione** `CalendarMilestoneInputSchema`:

- `severity?: MilestoneSeverity` (default 'NORMAL')
- `relevantCountries?: string[]` (sottoinsieme di `RELEVANT_COUNTRY_CODES`, default `[]`)
- `anchors?: MilestoneAnchorInputSchema[]`

**Schema input what‑if** `WhatIfRequestSchema`:

- `calendarIds: string[]` (uno o più calendari, supporta vista multi‑brand)
- `proposedShifts: { milestoneId: string, newStartAt: string }[]`
- Output: `{ violations: Violation[], suggestion?: ProposedShift[] }`

Esportare tutti i nuovi schemi da `packages/core/src/index.ts`.

### 1.2 RBAC

Estendere `VALID_RESOURCE_ACTIONS`:

```ts
[RESOURCES.SEASON_CALENDAR]: ['create', 'read', 'update', 'delete', 'sync', 'export', 'simulate', 'configure_dependencies'] as const,
```

- `simulate`: chiamare il what‑if engine. Concesso a editor + viewer (è read‑only).
- `configure_dependencies`: modificare archi (template e calendario). Solo admin/editor.

L'esecuzione di state effects che mutano CL/MP eredita i permessi della **risorsa target** (es. lock del CL richiede `collection_layout:update`), non della milestone. Verificare al momento dell'esecuzione, non al momento della definizione.

---

## Fase 2 — packages/calendar (estensione)

### 2.1 Modulo solver — `packages/calendar/src/solver/`

Struttura:

```
solver/
  types.ts               // Violation, ProposedShift, GraphInput
  graph.ts               // Costruzione grafo da milestone + dipendenze + festività
  detectViolations.ts    // Pure function: stato → violazioni
  suggestResolution.ts   // Pure function: forward propagation greedy
  topologicalSort.ts     // Helper: ordina nodi per propagazione
  __tests__/
    detectViolations.test.ts
    suggestResolution.test.ts
    fixtures/             // Grafi di esempio
```

**Tipi principali:**

```ts
export interface GraphInput {
  milestones: Array<{
    id: string;
    startAt: Date;
    endAt: Date | null;
    relevantCountries: string[];
    severity: MilestoneSeverity;
    isDisabled?: boolean; // per archi disabilitati
  }>;
  dependencies: Array<{
    predecessorId: string;
    successorId: string;
    minGapDays?: number;
    maxGapDays?: number;
    severity: DependencySeverity;
    reason?: string;
    isDisabled: boolean; // override calendario
  }>;
  holidays: Array<{
    countryCode: string;
    startDate: Date;
    endDate: Date;
    name: string;
  }>;
}

export interface Violation {
  type:
    | 'GAP_MIN'
    | 'GAP_MAX'
    | 'HOLIDAY_OVERLAP'
    | 'CYCLE_DETECTED'
    | 'OVERCONSTRAINED';
  severity: 'HARD' | 'SOFT';
  milestoneIds: string[]; // milestone coinvolte
  dependencyId?: string; // se la violazione è su un arco
  details: string; // human‑readable per UI
  causalChain?: string[]; // catena di vincoli che ha portato alla violazione
}

export interface ProposedShift {
  milestoneId: string;
  fromStartAt: Date;
  toStartAt: Date;
  reason: string; // explainability
}
```

**`detectViolations(input: GraphInput, shifts: ProposedShift[]): Violation[]`**

Algoritmo:

1. Applica gli shift virtualmente (non muta input).
2. Per ogni dipendenza non disabled:
   - Verifica `actualGap >= minGapDays` (se definito) → violazione `GAP_MIN`
   - Verifica `actualGap <= maxGapDays` (se definito) → violazione `GAP_MAX`
3. Per ogni milestone con `relevantCountries.length > 0`:
   - Per ogni paese, verifica overlap con festività di quel paese → violazione `HOLIDAY_OVERLAP` (sempre SOFT)
4. Verifica che il grafo non abbia cicli → `CYCLE_DETECTED` (HARD)

**`suggestResolution(input: GraphInput, shifts: ProposedShift[]): ProposedShift[] | null`**

Algoritmo:

1. Topological sort sui nodi (errore se ciclo).
2. Forward propagation: per ogni nodo in ordine topologico:
   - `earliestStart = max(predecessor.endAt + minGapDays)` per tutti i predecessori HARD
   - Se `earliestStart > current.startAt` → genera shift proposto
3. Verifica vincoli `maxGapDays` HARD: se il forward propagation viola `maxGapDays`, il sistema è **overconstrained** → ritorna `null`.
4. **Non tocca** vincoli SOFT: l'utente decide se accettare warning festività e simili.
5. Output: lista minimale di shift che risolve gli HARD.

**Importante — explainability**: ogni `ProposedShift` porta `reason` (es. "Spostato +3gg per rispettare gap minimo 10gg da 'First samples' (HARD)"). Mostrato in UI così l'utente capisce.

**Test parametrici**: file fixture con grafi sintetici (catene lineari, fork, join, cicli, overconstrained, festività multiple). Coverage minima 90% sul modulo solver.

### 2.2 State effects engine — `packages/calendar/src/effects/`

```
effects/
  types.ts            // StateEffect, EffectExecutionResult
  registry.ts         // Mappa enum → handler
  handlers/
    lockCollectionLayout.ts
    unlockCollectionLayout.ts
    // confirmMerchandisingPlan.ts  (condizionale)
  executor.ts         // Esegue effect + persiste snapshot per rollback
  rollback.ts         // Annulla effect usando snapshot
```

**Handler signature:**

```ts
export interface StateEffectContext {
  prisma: PrismaClient;
  userId: string;
  milestoneId: string;
  targetEntityId: string;
}

export interface StateEffectHandler {
  execute(ctx: StateEffectContext): Promise<{ previousStateSnapshot: Json }>;
  rollback(ctx: StateEffectContext, snapshot: Json): Promise<void>;
  validate(ctx: StateEffectContext): Promise<void>; // pre‑condizioni
}
```

**Pattern di esecuzione** (in `executor.ts`):

1. `validate()` — verifica pre‑condizioni (es. CL esiste, è in stato compatibile, l'utente ha il permesso `collection_layout:update`).
2. Snapshot dello stato precedente.
3. Mutazione (Prisma transaction).
4. Persistenza in `MilestoneStateEffectExecution` con timestamp, userId, snapshot.
5. Audit log.

**Pattern di rollback** (in `rollback.ts`):

- Cerca `MilestoneStateEffectExecution` non rollback‑ed.
- Recupera snapshot.
- Esegue handler.rollback() in transazione.
- Marca `rolledBackAt` + `rolledBackByUserId`.

**Whitelist obbligatoria**: il registry rifiuta qualsiasi `effectType` non presente nella mappa. Prima riga del file `registry.ts`:

```ts
const REGISTRY: Record<StateEffectType, StateEffectHandler> = {
  LOCK_COLLECTION_LAYOUT: lockCollectionLayoutHandler,
  UNLOCK_COLLECTION_LAYOUT: unlockCollectionLayoutHandler,
};
// Tipo che obbliga al match esaustivo: TS error se enum aggiornato senza handler
```

### 2.3 Holiday data layer

```
holidays/
  loader.ts        // Carica YAML seed → memoria
  query.ts         // findOverlapping(startDate, endDate, countryCodes[])
```

Pure functions (no DB se tutto è in memoria, oppure findMany su `Holiday` se preferito). Per V2 caricamento da DB (seed in fase 6) tramite Prisma — più semplice da estendere.

---

## Fase 3 — Database (Prisma)

### 3.1 Estensioni a modelli esistenti

```prisma
model CalendarMilestone {
  // campi esistenti V1 ...
  severity            MilestoneSeverity  @default(NORMAL)
  relevantCountries   String[]           // ISO codes

  // nuove relazioni
  dependenciesAsPredecessor MilestoneDependency[]    @relation("DependencyPredecessor")
  dependenciesAsSuccessor   MilestoneDependency[]    @relation("DependencySuccessor")
  stateEffects              MilestoneStateEffect[]
  anchors                   MilestoneAnchor[]
  effectExecutions          MilestoneStateEffectExecution[]
}

model MilestoneTemplateItem {
  // campi esistenti V1 ...
  severity            MilestoneSeverity  @default(NORMAL)
  relevantCountries   String[]

  // nuove relazioni
  dependenciesAsPredecessor MilestoneTemplateDependency[]  @relation("TemplateDepPredecessor")
  dependenciesAsSuccessor   MilestoneTemplateDependency[]  @relation("TemplateDepSuccessor")
  stateEffects              MilestoneTemplateStateEffect[]
}
```

### 3.2 Nuovi modelli

```prisma
enum DependencySeverity {
  HARD
  SOFT
}

enum MilestoneSeverity {
  CRITICAL
  NORMAL
  INFO
}

enum StateEffectType {
  LOCK_COLLECTION_LAYOUT
  UNLOCK_COLLECTION_LAYOUT
  // CONFIRM_MERCHANDISING_PLAN  // attivare solo se MP esiste
  // UNCONFIRM_MERCHANDISING_PLAN
}

enum AnchorEntityType {
  COLLECTION_LAYOUT
  COLLECTION_LAYOUT_ROW
  MERCHANDISING_PLAN
  MERCHANDISING_PLAN_SKU
}

model MilestoneTemplateDependency {
  id              String              @id @default(uuid())
  predecessorId   String
  successorId     String
  minGapDays      Int?
  maxGapDays      Int?
  severity        DependencySeverity
  reason          String?

  predecessor MilestoneTemplateItem @relation("TemplateDepPredecessor", fields: [predecessorId], references: [id], onDelete: Cascade)
  successor   MilestoneTemplateItem @relation("TemplateDepSuccessor",   fields: [successorId],   references: [id], onDelete: Cascade)

  @@unique([predecessorId, successorId])
  @@index([successorId])
}

model MilestoneDependency {
  id                String              @id @default(uuid())
  predecessorId     String
  successorId       String
  minGapDays        Int?
  maxGapDays        Int?
  severity          DependencySeverity   // immutabile dopo creazione
  reason            String?
  isDisabled        Boolean              @default(false)
  inheritedFromId   String?              // ref a MilestoneTemplateDependency, null se custom

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  predecessor CalendarMilestone @relation("DependencyPredecessor", fields: [predecessorId], references: [id], onDelete: Cascade)
  successor   CalendarMilestone @relation("DependencySuccessor",   fields: [successorId],   references: [id], onDelete: Cascade)

  @@unique([predecessorId, successorId])
  @@index([successorId])
}

model MilestoneTemplateStateEffect {
  id                    String          @id @default(uuid())
  templateItemId        String
  effectType            StateEffectType
  targetEntityType      String           // ridondante con effectType ma utile in query
  requiresConfirmation  Boolean          @default(true)

  templateItem MilestoneTemplateItem @relation(fields: [templateItemId], references: [id], onDelete: Cascade)

  @@index([templateItemId])
}

model MilestoneStateEffect {
  id                    String          @id @default(uuid())
  milestoneId           String
  effectType            StateEffectType
  targetEntityType      String
  targetEntityId        String
  requiresConfirmation  Boolean

  milestone CalendarMilestone @relation(fields: [milestoneId], references: [id], onDelete: Cascade)
  executions MilestoneStateEffectExecution[]

  @@index([milestoneId])
  @@index([targetEntityType, targetEntityId])
}

model MilestoneStateEffectExecution {
  id                    String   @id @default(uuid())
  effectId              String
  milestoneId           String
  appliedAt             DateTime @default(now())
  appliedByUserId       String
  previousStateSnapshot Json
  rolledBackAt          DateTime?
  rolledBackByUserId    String?

  effect    MilestoneStateEffect @relation(fields: [effectId], references: [id], onDelete: Cascade)
  milestone CalendarMilestone    @relation(fields: [milestoneId], references: [id], onDelete: Cascade)
  appliedBy User                 @relation("EffectExecutor", fields: [appliedByUserId], references: [id])
  rolledBackBy User?             @relation("EffectRollbacker", fields: [rolledBackByUserId], references: [id])

  @@index([milestoneId])
  @@index([effectId])
}

model MilestoneAnchor {
  id          String           @id @default(uuid())
  milestoneId String
  entityType  AnchorEntityType
  entityId    String

  createdAt DateTime @default(now())

  milestone CalendarMilestone @relation(fields: [milestoneId], references: [id], onDelete: Cascade)

  @@unique([milestoneId, entityType, entityId])
  @@index([entityType, entityId])
}

model HolidayCountry {
  code      String  @id           // ISO‑3166‑1 alpha‑2
  name      String
  active    Boolean @default(true)

  holidays Holiday[]
}

model Holiday {
  id          String   @id @default(uuid())
  countryCode String
  name        String
  startDate   DateTime @db.Date
  endDate     DateTime @db.Date

  country HolidayCountry @relation(fields: [countryCode], references: [code])

  @@index([countryCode, startDate, endDate])
}
```

**Aggiungere back‑relations** su `User` (per `EffectExecutor` e `EffectRollbacker`).

### 3.3 Migration

```bash
pnpm --filter api prisma migrate dev --name add_what_if_engine
```

### 3.4 Seed festività — `apps/api/prisma/seeds/holidays/`

Struttura:

```
holidays/
  countries.yaml        # IT, CN, VN, IN, TR (code, name, active)
  IT-2026.yaml
  CN-2026.yaml
  VN-2026.yaml
  IN-2026.yaml
  TR-2026.yaml
  IT-2027.yaml
  ...
```

Esempio `CN-2026.yaml`:

```yaml
- name: Chinese New Year
  startDate: 2026-02-17
  endDate: 2026-02-23
- name: Qingming Festival
  startDate: 2026-04-05
  endDate: 2026-04-05
# ...
```

Script seed `seedHolidays.ts` idempotente (upsert su `(countryCode, name, startDate)`). **Aggiornamento manuale annuale** documentato in `docs/holidays-update.md`.

### 3.5 Seed template aggiornato

Estendere il seed V1 `milestoneTemplates.ts` aggiungendo per ogni item:

- `severity`, `relevantCountries`
- Le `MilestoneTemplateDependency` rilevanti (es. "Linesheet review" depends on "First samples" con `minGapDays = 30`, severity HARD)
- Le `MilestoneTemplateStateEffect` (es. "Linesheet review" → `LOCK_COLLECTION_LAYOUT` con `requiresConfirmation = true`)

---

## Fase 4 — API (apps/api)

### 4.1 Estensioni router `seasonCalendar`

Aggiungere procedure:

| Procedura                  | Tipo     | Input                                              | Note                                                                                              |
| -------------------------- | -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `simulate`                 | query    | `WhatIfRequestSchema`                              | Chiama solver. `season_calendar:simulate`. Read‑only, no audit.                                   |
| `getDependencies`          | query    | `{ calendarId }`                                   | Restituisce tutte le dipendenze (ereditate + custom).                                             |
| `addDependency`            | mutation | `MilestoneDependencyInputSchema`                   | Custom. Severity obbligatoria. `season_calendar:configure_dependencies`.                          |
| `updateDependencyGaps`     | mutation | `{ id, minGapDays?, maxGapDays? }`                 | Override gap. **Non** modifica severity. Audit.                                                   |
| `toggleDependencyDisabled` | mutation | `{ id, isDisabled }`                               | Disabilita/riabilita un arco ereditato. Audit.                                                    |
| `deleteDependency`         | mutation | `{ id }`                                           | Solo archi custom (`inheritedFromId === null`). Audit.                                            |
| `setMilestoneAnchors`      | mutation | `{ milestoneId, anchors: MilestoneAnchorInput[] }` | Sostituisce gli anchor. Audit.                                                                    |
| `executeStateEffect`       | mutation | `{ effectId }`                                     | Esegue effect manualmente (per quelli con `requiresConfirmation`). Permesso sulla risorsa target. |
| `rollbackStateEffect`      | mutation | `{ executionId }`                                  | Rollback. Permesso sulla risorsa target. Audit.                                                   |

**`setMilestoneStatus` (esistente in V1) va esteso**: quando una milestone passa a `COMPLETED`, l'API:

1. Itera sui suoi `MilestoneStateEffect`.
2. Per ognuno con `requiresConfirmation === false` → esegue automaticamente (executor).
3. Per ognuno con `requiresConfirmation === true` → segnala come `pending` nella response, l'utente deve chiamare `executeStateEffect` esplicitamente.
4. Restituisce `{ milestone, autoApplied: [...], pending: [...] }`.

Quando una milestone torna da `COMPLETED` a un altro stato, fare rollback automatico degli effect non‑confirmation e segnalare quelli con confirmation come da rivedere.

### 4.2 Pattern transazionale per state effects

```ts
await prisma.$transaction(async tx => {
  // 1. Update milestone status
  // 2. Per ogni auto‑effect:
  //    - validate
  //    - snapshot
  //    - mutation
  //    - persist execution
  // 3. Audit
});
```

Il sync Google resta **fuori** dalla transazione come in V1.

### 4.3 Materializzazione dipendenze su `applyTemplate` e `cloneFromBrandSeason`

Quando si applica un template:

- Per ogni `MilestoneTemplateDependency` → crea `MilestoneDependency` con `inheritedFromId` settato.
- Stessa logica per `MilestoneTemplateStateEffect` → `MilestoneStateEffect`.

Quando si clona da un altro calendario:

- Le `MilestoneDependency` originarie vengono copiate (con `inheritedFromId` preservato se ereditate, `null` se erano custom — ma potrebbero diventare custom anche sul target, va deciso: per default mantieni `inheritedFromId` se il template è disponibile in entrambi i calendari, altrimenti diventa custom).

---

## Fase 5 — Frontend (apps/web)

### 5.1 Timeline interattiva

**Verificare** se in V1 si è scelto un componente timeline custom o libreria. Estenderlo per supportare:

- **Drag‑and‑drop** sulle milestone per shiftarle (orizzontale = tempo).
- **Color overlay** in real‑time durante il drag:
  - Verde: nessuna violazione
  - Giallo: solo violazioni SOFT
  - Rosso: una o più violazioni HARD
- **Hover su una violazione** → tooltip con `Violation.details` e `causalChain`.

Durante il drag, lo stato della pagina chiama `simulate` (debounced 300ms) per ottenere violazioni in tempo reale. Le violazioni sono renderizzate come overlay sulla timeline (linee rosse fra milestone in conflitto, fasce di sfondo per overlap festività).

### 5.2 Festività come bande di sfondo

Sulla timeline le festività dei paesi attualmente "rilevanti per almeno una milestone visibile" sono mostrate come **bande verticali colorate** di sfondo (color coding per paese, simile al brand color coding di V1). Tooltip al hover con nome festività e paese.

L'utente può togglare la visualizzazione festività via un controllo nel pannello sinistro.

### 5.3 Comando "Suggerisci risoluzione"

Quando ci sono violazioni HARD pendenti dopo uno shift, appare un bottone primario **"Suggerisci risoluzione"** nella toolbar.

Click → chiamata a `simulate` con flag `requestSuggestion: true` (o procedura separata). Il backend ritorna `ProposedShift[]`. Il frontend:

1. Renderizza un **overlay diff** sulla timeline: posizioni attuali in trasparenza, posizioni proposte solide.
2. Pannello laterale con lista degli shift proposti e le `reason` per ognuno.
3. Tre bottoni: **"Accetta tutto"** | **"Modifica"** (passa in modalità manuale con la proposta come baseline) | **"Rifiuta"** (torna allo stato precedente).

### 5.4 `MilestoneDetailDrawer` esteso

Aggiungere sezioni:

- **Dipendenze** — lista archi entranti e uscenti, con severity badge. Ogni voce ha azioni: modifica gap (se non disabled), disabilita/riabilita (se ereditata), elimina (se custom). **Severity sempre read‑only.**
- **State effects** — lista degli effect configurati, con stato (`pending` / `applied` / `rolled-back`). Bottoni per esecuzione manuale (se `requiresConfirmation`) e rollback (se applied).
- **Entità ancorate** — lista degli anchor, con link diretti alle entità (es. apertura del CL specifico, evidenziazione della riga CL ancorata). UI selector (autocomplete) per aggiungerne di nuove.
- **Paesi rilevanti** — multi‑select dai paesi attivi. Aggiornare scatena re‑calcolo violazioni.
- **Severity** — single select (CRITICAL / NORMAL / INFO). Influenza priorità visiva sulla timeline.

### 5.5 Sandbox client‑only

Lo stato di simulazione vive in React state (es. Zustand store dedicato `useWhatIfStore`). Operazioni:

- `applyShift(milestoneId, newDate)` — aggiorna stato locale, scatena `simulate` debounced.
- `commit()` — manda mutation `updateMilestone` sequenziale per ogni shift modificato.
- `discard()` — reset allo stato server.

Banner persistente in alto **"Modalità simulazione attiva — N modifiche non salvate"** con bottoni **Salva** e **Annulla**.

### 5.6 Pannello "Conflitti correnti"

Nel sidebar, sotto i filtri, aggiungere pannello compatto:

- Conteggio violazioni per severity (HARD in rosso, SOFT in giallo).
- Click su un conteggio → lista delle violazioni → click su una violazione → scroll automatico alla milestone interessata + highlight.

---

## Fase 6 — Operations

### 6.1 Configurazione iniziale

Documentare in `docs/what-if-engine-setup.md`:

1. Esecuzione seed festività.
2. Mappa dei tipi di state effect attivi e relativi handler.
3. Procedura per aggiornare festività anno per anno (script + revisione).
4. Esempi di template estesi (con dipendenze e state effects) per i casi d'uso FEBOS.

### 6.2 Verifica MP integration

Prima di abilitare gli effect MP (`CONFIRM_MERCHANDISING_PLAN`, `UNCONFIRM_MERCHANDISING_PLAN`):

- Verificare che i modelli MP esistano in schema.prisma.
- Verificare che esista una transition di stato pubblica su MP.
- Verificare che il permesso `merchandising_plan:update` esista e sia distribuito coerentemente.

Se anche solo uno dei tre fallisce, **lasciare gli effect MP commentati** in `STATE_EFFECT_TYPE` e `REGISTRY` con TODO esplicito.

---

## Out of scope (V3 — non implementare ora)

- `WhatIfSession` server‑side persistente (scenari condivisibili, confronti A/B).
- Wizard di setup stagione come simulation session dedicata (V2 ha già il what‑if a runtime, basta).
- Trasferte come dominio dedicato (in V2 modellate come milestone con `relevantCountries`).
- Artifacts multimodali (note vocali, OCR di appunti cartacei). In V2 si usa il sistema allegati esistente di Luke se presente, altrimenti zero.
- Calendari festività per altri paesi oltre IT/CN/VN/IN/TR. Aggiungerne di nuovi via seed in futuro.
- Integrazioni meeting (Google Meet, Zoom).
- Task management interno alle milestone (subtask, assignment, ecc.).

---

## Checklist finale

- [ ] CLAUDE.md, lessons.md e TASK_season_calendar.md letti
- [ ] V1 funziona ancora in tutti i suoi flussi (nessuna regressione)
- [ ] Modulo `packages/calendar/src/solver/` come pure functions, no IO, coverage ≥ 90%
- [ ] State effects whitelistati con type‑safety enforced (TS error se enum aggiornato senza handler)
- [ ] Reversibilità garantita per ogni state effect che muta stato di entità
- [ ] Severity ereditata dai template è immutabile sul calendario
- [ ] Override sui gap supportato; disabilitazione di archi ereditati supportata; severity sempre read‑only
- [ ] MP integration: verificata e abilitata se MP esiste, altrimenti commentata con TODO
- [ ] Seed festività IT/CN/VN/IN/TR per anno corrente + prossimo, idempotente
- [ ] Procedura documentata per aggiornamento annuale festività
- [ ] Timeline drag‑and‑drop con conflict detection real‑time (debounced 300ms)
- [ ] Comando "Suggerisci risoluzione" con overlay diff e accept/modify/reject
- [ ] Sandbox client‑only con banner "Modalità simulazione attiva"
- [ ] `MilestoneDetailDrawer` esteso con dipendenze, state effects, anchor, severity, paesi rilevanti
- [ ] Pannello "Conflitti correnti" nel sidebar
- [ ] Niente WhatIfSession server‑side (rinviato a V3)
- [ ] Niente LLM nel solver
- [ ] Audit log su modifica dipendenze, esecuzione/rollback state effects
- [ ] Festività come bande di sfondo sulla timeline, togglable
- [ ] `pnpm build` e `pnpm test` passano senza regressioni
