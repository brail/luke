/**
 * Unit tests for the pure functions of the alert engine (`phaseAlert.service.ts`)
 * that operate on an already-resolved array of events — no Prisma access, hence
 * unit tier, not integration.
 *
 * Minimal fixtures: the functions under test only read `id` and
 * `phase.{order,isActive}` from the events; the other scalar fields of
 * `CalendarEvent` are set with placeholders just to satisfy the type (derived via
 * `Parameters<>` instead of importing the private type `CalendarEventWithContext`,
 * not exported by the module — this file is test-only, it doesn't touch
 * application code).
 */

import { describe, it, expect } from 'vitest';

import {
  getActivePhaseFromEvents,
  getNextPhaseFromEvents,
  getCompletionDeadlineEvent,
  getMissingPhasesForCompletion,
  completionOutcome,
  filterApplicableEvents,
  type ActivePhaseResult,
} from '../src/services/phaseAlert.service';

type RowEvent = Parameters<typeof getActivePhaseFromEvents>[0][number];

/** Builds a minimal calendar event, with only the phase that matters for these tests. */
function fakeEvent(opts: {
  id: string;
  planningGroupId?: string;
  phaseOrder: number | null;
  phaseIsActive?: boolean;
  /** Event deadline (`endAt ?? startAt`), for tests on the completion outcome. */
  deadline?: Date;
}): RowEvent {
  const now = new Date();
  return {
    id: opts.id,
    calendarId: 'cal-1',
    planningGroupId: opts.planningGroupId ?? 'pg-1',
    phaseId: opts.phaseOrder === null ? null : `phase-${opts.phaseOrder}`,
    calendarDaysRelevance: null,
    cancelledAt: null,
    cancelReason: null,
    cancelledByUserId: null,
    title: `Event ${opts.id}`,
    description: null,
    startAt: opts.deadline ?? now,
    endAt: null,
    baselineStartAt: null,
    baselineEndAt: null,
    allDay: false,
    publishExternally: true,
    templateItemId: null,
    createdAt: now,
    updatedAt: now,
    phase: opts.phaseOrder === null ? null : {
      order: opts.phaseOrder,
      value: `PHASE_${opts.phaseOrder}`,
      label: `Fase ${opts.phaseOrder}`,
      isActive: opts.phaseIsActive ?? true,
    },
  } as unknown as RowEvent;
}

describe('getActivePhaseFromEvents', () => {
  it('nessun evento applicabile → no-calendar', () => {
    expect(getActivePhaseFromEvents([], null)).toEqual({ status: 'no-calendar' });
  });

  it('currentOrder null → il primo evento diventa attivo (riga non ancora a nessuna fase)', () => {
    const first = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const second = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const result = getActivePhaseFromEvents([first, second], null);
    expect(result).toEqual({ status: 'active', event: first });
  });

  it('currentOrder oltre l\'ultima fase applicabile → completed', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 })];
    expect(getActivePhaseFromEvents(events, 5)).toEqual({ status: 'completed' });
  });

  it('currentOrder uguale alla fase di un evento → quell\'evento è attivo (>=, non >)', () => {
    // The row is "at" that phase, it hasn't passed it yet — its deadline still applies.
    const atOrder1 = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), atOrder1, fakeEvent({ id: 'e3', phaseOrder: 2 })];
    expect(getActivePhaseFromEvents(events, 1)).toEqual({ status: 'active', event: atOrder1 });
  });

  it('salta gli eventi su fase disattivata e misura contro la prima fase attiva successiva', () => {
    // `isActive: false` is a soft delete: a retired phase leaves the process and must no
    // longer produce deadlines, as was already the case for `getNextPhaseFromEvents`.
    const retired = fakeEvent({ id: 'e1', phaseOrder: 1, phaseIsActive: false });
    const live = fakeEvent({ id: 'e2', phaseOrder: 2 });
    expect(getActivePhaseFromEvents([retired, live], 1)).toEqual({ status: 'active', event: live });
  });

  it('solo eventi su fasi disattivate → completed, quindi nessun alert', () => {
    const events = [
      fakeEvent({ id: 'e1', phaseOrder: 1, phaseIsActive: false }),
      fakeEvent({ id: 'e2', phaseOrder: 2, phaseIsActive: false }),
    ];
    expect(getActivePhaseFromEvents(events, 0)).toEqual({ status: 'completed' });
  });
});

describe('getMissingPhasesForCompletion', () => {
  it('riga all\'ultima milestone → nessuna fase mancante', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), fakeEvent({ id: 'e2', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, 1)).toEqual([]);
  });

  it('riga indietro di una fase → elenca solo quella', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), fakeEvent({ id: 'e2', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, 0)).toEqual([{ value: 'PHASE_1', label: 'Fase 1' }]);
  });

  it('le fasi disattivate nell\'intervallo non contano come mancanti', () => {
    // They're no longer part of the process: asking for them before concluding would be noise.
    const events = [
      fakeEvent({ id: 'e1', phaseOrder: 0 }),
      fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false }),
      fakeEvent({ id: 'e3', phaseOrder: 2 }),
    ];
    expect(getMissingPhasesForCompletion(events, 0)).toEqual([{ value: 'PHASE_2', label: 'Fase 2' }]);
  });

  it('più eventi sulla stessa fase contano una volta sola', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 1 }), fakeEvent({ id: 'e1b', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, 0)).toEqual([{ value: 'PHASE_1', label: 'Fase 1' }]);
  });

  it('gruppo senza eventi di fase → nessun termine di paragone, nessun avviso', () => {
    expect(getMissingPhasesForCompletion([fakeEvent({ id: 'po', phaseOrder: null })], 0)).toEqual([]);
  });

  it('riga senza fase → mancano tutte', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), fakeEvent({ id: 'e2', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, null).map(p => p.value)).toEqual(['PHASE_0', 'PHASE_1']);
  });
});

describe('getNextPhaseFromEvents', () => {
  const notActive: ActivePhaseResult[] = [{ status: 'no-calendar' }, { status: 'completed' }];

  it.each(notActive)('nessuna fase attiva ($status) → null', active => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 })];
    expect(getNextPhaseFromEvents(events, active)).toBeNull();
  });

  it('fase attiva con un evento successivo a order maggiore → lo ritorna', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const next = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [active, next];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(next);
  });

  it('la fase attiva è l\'ultima applicabile → null (nessuna prossima fase da mostrare)', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 2 });
    const events = [fakeEvent({ id: 'e0', phaseOrder: 0 }), active];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toBeNull();
  });

  it('l\'unico candidato successivo è su una fase disattivata → null, non il candidato disattivato', () => {
    // Regression: a deactivated phase (isActive:false) remains referenced by an
    // existing CalendarEvent but disappears from the catalog (`phase.list` filters
    // isActive:true) — showing it as "next phase" produced an unresolvable label
    // on the frontend side ("—") instead of simply hiding the row.
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const inactiveNext = fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false });
    const events = [active, inactiveNext];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toBeNull();
  });

  it('salta un candidato disattivato e trova il successivo attivo oltre', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const inactiveNext = fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false });
    const activeNext = fakeEvent({ id: 'e3', phaseOrder: 2, phaseIsActive: true });
    const events = [active, inactiveNext, activeNext];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(activeNext);
  });

  it('più eventi sulla stessa fase attiva non contano come "prossima" — serve un order maggiore', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const sameOrderDuplicate = fakeEvent({ id: 'e1b', phaseOrder: 0 });
    const nextPhase = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [active, sameOrderDuplicate, nextPhase];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(nextPhase);
  });

  it('l\'evento attivo non fa parte dell\'array passato → null (activeIndex non trovato)', () => {
    const events = [fakeEvent({ id: 'e2', phaseOrder: 2 }), fakeEvent({ id: 'e3', phaseOrder: 3 })];
    // "Active" built separately, with an id that doesn't appear in `events`.
    const foreignActive = { status: 'active' as const, event: fakeEvent({ id: 'not-in-array', phaseOrder: 1 }) };
    expect(getNextPhaseFromEvents(events, foreignActive)).toBeNull();
  });
});

describe('getCompletionDeadlineEvent', () => {
  it('nessun evento → null', () => {
    expect(getCompletionDeadlineEvent([])).toBeNull();
  });

  it('solo eventi senza fase → null (fuori dal meccanismo delle fasi)', () => {
    const phaseless = fakeEvent({ id: 'po-cutoff', phaseOrder: null });
    expect(getCompletionDeadlineEvent([phaseless])).toBeNull();
  });

  it('solo eventi su fasi disattivate → null (non c\'è più nulla di pianificato da misurare)', () => {
    const retired = fakeEvent({ id: 'e1', phaseOrder: 3, phaseIsActive: false });
    expect(getCompletionDeadlineEvent([retired])).toBeNull();
  });

  it('salta le fasi disattivate che seguono l\'ultima attiva', () => {
    // The real case: a calendar with milestones on retired phases after the last phase still in use.
    // The completion deadline must remain the last *active* one, not the furthest overall.
    const events = [
      fakeEvent({ id: 'gate-1', phaseOrder: 0 }),
      fakeEvent({ id: 'gate-3', phaseOrder: 2 }),
      fakeEvent({ id: 'linesheet', phaseOrder: 3, phaseIsActive: false }),
      fakeEvent({ id: 'pre-opening', phaseOrder: 4, phaseIsActive: false }),
    ];
    expect(getCompletionDeadlineEvent(events)?.id).toBe('gate-3');
  });
});

describe('completionOutcome', () => {
  const thresholds = {
    default: { bands: [{ minDaysToDeadline: -9999, maxDaysToDeadline: null, color: '#000', label: 'B', emphasis: 'outline' as const }] },
    completedBand: { color: '#15803D', label: 'Concluso', emphasis: 'solid' as const },
    completedLateBand: { color: '#B91C1C', label: 'Concluso in ritardo', emphasis: 'solid' as const },
  };
  const ctx = { companyCountryCode: null, holidays: [] };
  const deadline = new Date('2026-08-31T00:00:00Z');

  it('senza milestone di riferimento → banda "in tempo" e nessun delta inventato', () => {
    const result = completionOutcome('row-1', new Date('2026-09-10T00:00:00Z'), null, thresholds, null, ctx);
    expect(result).toMatchObject({
      state: 'completed',
      daysVsDeadline: null,
      deadline: null,
      eventId: null,
      band: thresholds.completedBand,
    });
  });

  it('conclusa prima della scadenza → delta positivo (anticipo) e banda "in tempo"', () => {
    const event = fakeEvent({ id: 'gate-3', phaseOrder: 2, deadline });
    const result = completionOutcome('row-1', new Date('2026-08-12T00:00:00Z'), event, thresholds, null, ctx);
    expect(result.daysVsDeadline).toBe(19);
    expect(result.band).toEqual(thresholds.completedBand);
  });

  it('conclusa dopo la scadenza → delta negativo (ritardo) e banda "in ritardo"', () => {
    const event = fakeEvent({ id: 'gate-3', phaseOrder: 2, deadline });
    const result = completionOutcome('row-1', new Date('2026-09-10T00:00:00Z'), event, thresholds, null, ctx);
    expect(result.daysVsDeadline).toBe(-10);
    expect(result.band).toEqual(thresholds.completedLateBand);
  });

  it('conclusa nel giorno stesso della scadenza conta come in tempo', () => {
    const event = fakeEvent({ id: 'gate-3', phaseOrder: 2, deadline });
    const result = completionOutcome('row-1', deadline, event, thresholds, null, ctx);
    expect(result.daysVsDeadline).toBe(0);
    expect(result.band).toEqual(thresholds.completedBand);
  });
});

describe('filterApplicableEvents', () => {
  it('esclude eventi di un altro planning group', () => {
    const mine = fakeEvent({ id: 'e1', planningGroupId: 'pg-1', phaseOrder: 0 });
    const other = fakeEvent({ id: 'e2', planningGroupId: 'pg-2', phaseOrder: 1 });
    expect(filterApplicableEvents([mine, other], 'pg-1')).toEqual([mine]);
  });

  it('ordina per phase.order crescente', () => {
    const late = fakeEvent({ id: 'e1', phaseOrder: 2 });
    const early = fakeEvent({ id: 'e2', phaseOrder: 0 });
    const mid = fakeEvent({ id: 'e3', phaseOrder: 1 });
    expect(filterApplicableEvents([late, early, mid], 'pg-1').map(e => e.id)).toEqual(['e2', 'e3', 'e1']);
  });
});
