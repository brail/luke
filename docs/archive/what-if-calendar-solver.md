# What-If Calendar Solver — Archivio (rimosso 2026-07)

Feature rimossa per semplificare calendario/pianificazione (troppa complessità configurativa
per basso valore d'uso). Questo doc conserva design e algoritmo per un'eventuale reintroduzione
futura, così da non ripartire da zero.

Codice completo pre-rimozione: branch git locale `archive/what-if-calendar` (non pushato).

## Cos'era

Simulatore "what-if" per il calendario stagionale: permetteva di trascinare eventi in modalità
preview, calcolare violazioni di vincoli (dipendenze temporali tra milestone, gap min/max,
sovrapposizioni con festività) e suggerire automaticamente uno spostamento date che risolvesse
i vincoli HARD.

## Architettura

Package isolato: `packages/calendar/src/solver/` (dentro `@luke/calendar`, che gestiva anche
Google Calendar sync e export iCal — solo `solver/` era what-if-specific).

- `types.ts` — `SolverEvent`, `SolverDependency`, `SolverHoliday`, `GraphInput`, `Violation`,
  `ProposedShift`, `SimulationResult`
- `graph.ts` — `buildGraph()`: costruisce adjacency list (eventMap, activeDeps,
  predecessorsOf/successorsOf), escludendo dipendenze disabilitate
- `topologicalSort.ts` — Kahn's BFS topological sort; lancia `CYCLE_DETECTED` se il grafo
  ha un ciclo
- `detectViolations.ts` — 3 check in ordine:
  1. **CYCLE_DETECTED** (HARD) — se il grafo è ciclico, ritorna subito (altri check non validi
     su grafo ciclico)
  2. **GAP_MIN / GAP_MAX** — per ogni dipendenza attiva, confronta il gap effettivo tra fine
     predecessore e inizio successore contro le soglie configurate; severity ereditata dalla
     dipendenza (HARD/SOFT)
  3. **HOLIDAY_OVERLAP** (sempre SOFT) — per eventi con `relevantCountries` non vuoto, verifica
     sovrapposizione date con festività di quei paesi
  - Gli shift proposti sono applicati **virtualmente**, l'input originale non viene mai mutato
- `suggestResolution.ts` — risolutore greedy: forward-propagation in ordine topologico,
  sposta ogni evento in avanti solo per rispettare gap minimi da predecessori **HARD**
  (le dipendenze SOFT sono ignorate nella propagazione). Dopo la propagazione verifica che
  nessun vincolo `maxGapDays` HARD sia violato; se lo è, ritorna `null` (over-constrained).
  Ritorna anche `null` su grafo ciclico (il chiamante deve girare prima `detectViolations`).

## Modello dati (Prisma)

- `enum DependencySeverity` (HARD | SOFT)
- `model CalendarEventDependency` — dipendenza tra due `CalendarEvent` (predecessor/successor),
  con `minGapDays`, `maxGapDays`, `severity`, `reason`, `isDisabled`
- `model MilestoneTemplateDependency` — stesso pattern a livello di `MilestoneTemplateItem`,
  propagato ai `CalendarEvent` generati via `applyTemplate()`

Bundled nella migration `20260527060509_add_what_if_engine_v2a`, insieme a feature non
correlate (state effects, anchors, holidays, vendor closures) — **una reintroduzione futura
deve isolare solo le tabelle dependency**, non ripristinare l'intera migration.

## Backend (tRPC)

- `apps/api/src/routers/seasonCalendar.ts`: mutation `simulate` — caricava eventi+dipendenze
  della season, festività rilevanti via `loadHolidaysForSolver()` (holidayQuery.ts), costruiva
  `GraphInput` e chiamava `detectViolations` + `suggestResolution`
- CRUD dipendenze evento: `getDependencies`, `addDependency`, `updateDependencyGaps`,
  `toggleDependencyDisabled`, `deleteDependency`
- CRUD dipendenze template: `addTemplateDependency`, `updateTemplateDependencyGaps`,
  `deleteTemplateDependency`
- RBAC: azioni `simulate` e `configure_dependencies` su resource `season_calendar`

## Frontend

- `WhatIfBanner.tsx` — banner sticky mostrato in modalità what-if (drag-preview); azione
  "Applica" bloccata se presente almeno una violazione HARD
- `DependencyManager.tsx` — tab "Dipendenze" nel dialog evento singolo
- `TemplateDependencyManager.tsx` — stesso pattern per i template milestone in admin
- Stato drag-preview in `calendar/page.tsx`: `simulateMode`, `proposedShifts`, `simulateResult`

## Codice sorgente completo (snapshot)

I file seguenti sono riportati integralmente per riferimento futuro (versione al momento
della rimozione). Vedi anche branch `archive/what-if-calendar`.

### `types.ts`

```ts
import type { DependencySeverity, EventSeverity, WorkingDayHoliday } from '@luke/core';

export interface SolverEvent {
  id: string;
  startAt: Date;
  endAt: Date | null;
  relevantCountries: string[];
  severity: EventSeverity;
}

export interface SolverDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  minGapDays?: number;
  maxGapDays?: number;
  severity: DependencySeverity;
  reason?: string;
  isDisabled: boolean;
}

export type SolverHoliday = WorkingDayHoliday;

export interface GraphInput {
  events:       SolverEvent[];
  dependencies: SolverDependency[];
  holidays:     SolverHoliday[];
}

export interface Violation {
  type:          'GAP_MIN' | 'GAP_MAX' | 'HOLIDAY_OVERLAP' | 'CYCLE_DETECTED' | 'OVERCONSTRAINED';
  severity:      'HARD' | 'SOFT';
  eventIds:      string[];
  dependencyId?: string;
  details:       string;
  causalChain?:  string[];
}

export interface ProposedShift {
  eventId:     string;
  fromStartAt: Date;
  toStartAt:   Date;
  reason:      string;
}

export interface SimulationResult {
  violations: Violation[];
  suggestion: ProposedShift[] | null;
}
```

### `graph.ts`

```ts
import type { GraphInput, SolverDependency, SolverEvent } from './types.js';

export interface BuiltGraph {
  eventMap:       Map<string, SolverEvent>;
  activeDeps:     SolverDependency[];
  predecessorsOf: Map<string, SolverDependency[]>;
  successorsOf:   Map<string, SolverDependency[]>;
}

export function buildGraph(input: GraphInput): BuiltGraph {
  const eventMap = new Map(input.events.map(e => [e.id, e]));
  const activeDeps = input.dependencies.filter(d => !d.isDisabled);

  const predecessorsOf = new Map<string, SolverDependency[]>();
  const successorsOf   = new Map<string, SolverDependency[]>();

  for (const dep of activeDeps) {
    const preds = predecessorsOf.get(dep.successorId) ?? [];
    preds.push(dep);
    predecessorsOf.set(dep.successorId, preds);

    const succs = successorsOf.get(dep.predecessorId) ?? [];
    succs.push(dep);
    successorsOf.set(dep.predecessorId, succs);
  }

  return { eventMap, activeDeps, predecessorsOf, successorsOf };
}
```

### `topologicalSort.ts`

```ts
import type { SolverDependency } from './types.js';

export function topologicalSort(
  eventIds: string[],
  dependencies: SolverDependency[],
): string[] {
  const activeDeps = dependencies.filter(d => !d.isDisabled);

  const inDegree  = new Map<string, number>();
  const successors = new Map<string, string[]>();

  for (const id of eventIds) {
    inDegree.set(id, 0);
    successors.set(id, []);
  }

  for (const dep of activeDeps) {
    inDegree.set(dep.successorId, (inDegree.get(dep.successorId) ?? 0) + 1);
    const succs = successors.get(dep.predecessorId) ?? [];
    succs.push(dep.successorId);
    successors.set(dep.predecessorId, succs);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const succ of successors.get(node) ?? []) {
      const newDeg = (inDegree.get(succ) ?? 1) - 1;
      inDegree.set(succ, newDeg);
      if (newDeg === 0) queue.push(succ);
    }
  }

  if (sorted.length !== eventIds.length) {
    throw new Error('CYCLE_DETECTED');
  }

  return sorted;
}
```

### `detectViolations.ts`

```ts
import { daysBetween } from '@luke/core';

import { buildGraph } from './graph.js';
import { topologicalSort } from './topologicalSort.js';
import type { GraphInput, ProposedShift, Violation } from './types.js';

export function detectViolations(
  input: GraphInput,
  shifts: ProposedShift[],
): Violation[] {
  const violations: Violation[] = [];

  const shiftMap = new Map(shifts.map(s => [s.eventId, s.toStartAt]));

  const effectiveStartAt = new Map<string, Date>();
  const effectiveEndAt   = new Map<string, Date>();

  for (const event of input.events) {
    const newStart = shiftMap.get(event.id) ?? event.startAt;
    const delta = daysBetween(event.startAt, newStart);
    effectiveStartAt.set(event.id, newStart);

    if (event.endAt) {
      const newEnd = new Date(event.endAt);
      newEnd.setDate(newEnd.getDate() + delta);
      effectiveEndAt.set(event.id, newEnd);
    } else {
      effectiveEndAt.set(event.id, newStart);
    }
  }

  try {
    topologicalSort(
      input.events.map(e => e.id),
      input.dependencies,
    );
  } catch {
    violations.push({
      type: 'CYCLE_DETECTED',
      severity: 'HARD',
      eventIds: input.events.map(e => e.id),
      details: 'Ciclo rilevato nel grafo delle dipendenze',
    });
    return violations;
  }

  const { activeDeps } = buildGraph(input);

  for (const dep of activeDeps) {
    const predEnd  = effectiveEndAt.get(dep.predecessorId);
    const succStart = effectiveStartAt.get(dep.successorId);
    if (!predEnd || !succStart) continue;

    const actualGap = daysBetween(predEnd, succStart);

    if (dep.minGapDays !== undefined && dep.minGapDays !== null && actualGap < dep.minGapDays) {
      violations.push({
        type: 'GAP_MIN',
        severity: dep.severity,
        eventIds: [dep.predecessorId, dep.successorId],
        dependencyId: dep.id,
        details: `Gap ${actualGap}gg < minimo ${dep.minGapDays}gg${dep.reason ? ` (${dep.reason})` : ''}`,
      });
    }

    if (dep.maxGapDays !== undefined && dep.maxGapDays !== null && actualGap > dep.maxGapDays) {
      violations.push({
        type: 'GAP_MAX',
        severity: dep.severity,
        eventIds: [dep.predecessorId, dep.successorId],
        dependencyId: dep.id,
        details: `Gap ${actualGap}gg > massimo ${dep.maxGapDays}gg${dep.reason ? ` (${dep.reason})` : ''}`,
      });
    }
  }

  for (const event of input.events) {
    if (event.relevantCountries.length === 0) continue;

    const start = effectiveStartAt.get(event.id)!;
    const end   = effectiveEndAt.get(event.id)!;

    const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endUtc   = Date.UTC(end.getFullYear(),   end.getMonth(),   end.getDate());

    for (const holiday of input.holidays) {
      if (!event.relevantCountries.includes(holiday.countryCode)) continue;

      const hStart = Date.UTC(holiday.startDate.getFullYear(), holiday.startDate.getMonth(), holiday.startDate.getDate());
      const hEnd   = Date.UTC(holiday.endDate.getFullYear(),   holiday.endDate.getMonth(),   holiday.endDate.getDate());

      if (startUtc <= hEnd && endUtc >= hStart) {
        violations.push({
          type: 'HOLIDAY_OVERLAP',
          severity: 'SOFT',
          eventIds: [event.id],
          details: `Evento sovrapposto a festività ${holiday.countryCode}`,
        });
      }
    }
  }

  return violations;
}
```

### `suggestResolution.ts`

```ts
import { daysBetween, addDays } from '@luke/core';

import { buildGraph } from './graph.js';
import { topologicalSort } from './topologicalSort.js';
import type { GraphInput, ProposedShift } from './types.js';

export function suggestResolution(
  input: GraphInput,
  shifts: ProposedShift[],
): ProposedShift[] | null {
  const { eventMap, predecessorsOf } = buildGraph(input);

  let sortedIds: string[];
  try {
    sortedIds = topologicalSort(input.events.map(e => e.id), input.dependencies);
  } catch {
    return null;
  }

  const shiftMap = new Map(shifts.map(s => [s.eventId, s.toStartAt]));

  const workingStartAt = new Map<string, Date>();
  const workingEndAt   = new Map<string, Date>();

  for (const event of input.events) {
    const start = shiftMap.get(event.id) ?? event.startAt;
    workingStartAt.set(event.id, start);

    if (event.endAt) {
      const delta = daysBetween(event.startAt, start);
      const end = addDays(event.endAt, delta);
      workingEndAt.set(event.id, end);
    } else {
      workingEndAt.set(event.id, start);
    }
  }

  const result: ProposedShift[] = [];

  for (const eventId of sortedIds) {
    const event = eventMap.get(eventId);
    if (!event) continue;

    const preds = predecessorsOf.get(eventId) ?? [];
    const hardPreds = preds.filter(d => d.severity === 'HARD' && !d.isDisabled);

    let earliestStart = workingStartAt.get(eventId)!;

    for (const dep of hardPreds) {
      const predEnd = workingEndAt.get(dep.predecessorId);
      if (!predEnd) continue;

      const requiredStart = dep.minGapDays ? addDays(predEnd, dep.minGapDays) : predEnd;
      if (requiredStart > earliestStart) {
        earliestStart = requiredStart;
      }
    }

    const currentStart = workingStartAt.get(eventId)!;
    if (earliestStart > currentStart) {
      const originalStart = shiftMap.get(eventId) ?? event.startAt;
      const deltaDays = daysBetween(currentStart, earliestStart);
      const reason = `Spostato +${deltaDays}gg per rispettare gap minimo da predecessori HARD`;

      result.push({
        eventId,
        fromStartAt: originalStart,
        toStartAt: earliestStart,
        reason,
      });

      workingStartAt.set(eventId, earliestStart);
      if (event.endAt) {
        const delta = daysBetween(event.startAt, earliestStart);
        workingEndAt.set(eventId, addDays(event.endAt, delta));
      } else {
        workingEndAt.set(eventId, earliestStart);
      }
    }
  }

  const { activeDeps } = buildGraph(input);
  for (const dep of activeDeps) {
    if (dep.severity !== 'HARD' || dep.maxGapDays === undefined || dep.maxGapDays === null) continue;

    const predEnd   = workingEndAt.get(dep.predecessorId);
    const succStart = workingStartAt.get(dep.successorId);
    if (!predEnd || !succStart) continue;

    const actualGap = daysBetween(predEnd, succStart);
    if (actualGap > dep.maxGapDays) {
      return null;
    }
  }

  return result;
}
```

## Se si reintroduce in futuro

- Il grosso del lavoro (~1000 LOC solver + ~500 LOC test) è recuperabile 1:1 dal branch
  `archive/what-if-calendar` — algoritmo puro, nessuna I/O, testabile in isolamento
- Isolare le tabelle `CalendarEventDependency`/`MilestoneTemplateDependency` in una migration
  dedicata (non riusare la vecchia, bundled con feature non correlate)
- Valutare se serve ancora `EventSeverity`/`relevantCountries` sull'evento per alimentare
  `HOLIDAY_OVERLAP`, oppure se conviene ridisegnare l'input del solver diversamente
