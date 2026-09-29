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

import { parseCalendarDate } from '@luke/core';

import {
  getActivePhaseFromEvents,
  getNextPhaseFromEvents,
  getCompletionDeadlineEvent,
  getMissingPhasesForCompletion,
  completionOutcome,
  byEventStartDay,
  criticalityFromActivePhase,
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
  allDay?: boolean;
  relevance?: 'COMPANY' | 'VENDOR' | 'BOTH';
}): RowEvent {
  const now = new Date();
  return {
    id: opts.id,
    calendarId: 'cal-1',
    planningGroupId: opts.planningGroupId ?? 'pg-1',
    phaseId: opts.phaseOrder === null ? null : `phase-${opts.phaseOrder}`,
    calendarDaysRelevance: opts.relevance ?? null,
    cancelledAt: null,
    cancelReason: null,
    cancelledByUserId: null,
    title: `Event ${opts.id}`,
    description: null,
    startAt: opts.deadline ?? now,
    endAt: null,
    baselineStartAt: null,
    baselineEndAt: null,
    allDay: opts.allDay ?? false,
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
  it('no applicable event → no-calendar', () => {
    expect(getActivePhaseFromEvents([], null)).toEqual({ status: 'no-calendar' });
  });

  it('currentOrder null → the first event becomes active (row not at any phase yet)', () => {
    const first = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const second = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const result = getActivePhaseFromEvents([first, second], null);
    expect(result).toEqual({ status: 'active', event: first });
  });

  it('currentOrder beyond the last applicable phase → completed', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 })];
    expect(getActivePhaseFromEvents(events, 5)).toEqual({ status: 'completed' });
  });

  it('currentOrder equal to an event phase → that event is active (>=, not >)', () => {
    // The row is "at" that phase, it hasn't passed it yet — its deadline still applies.
    const atOrder1 = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), atOrder1, fakeEvent({ id: 'e3', phaseOrder: 2 })];
    expect(getActivePhaseFromEvents(events, 1)).toEqual({ status: 'active', event: atOrder1 });
  });

  it('skips events on a deactivated phase and measures against the next active phase', () => {
    // `isActive: false` is a soft delete: a retired phase leaves the process and must no
    // longer produce deadlines, as was already the case for `getNextPhaseFromEvents`.
    const retired = fakeEvent({ id: 'e1', phaseOrder: 1, phaseIsActive: false });
    const live = fakeEvent({ id: 'e2', phaseOrder: 2 });
    expect(getActivePhaseFromEvents([retired, live], 1)).toEqual({ status: 'active', event: live });
  });

  it('only events on deactivated phases → completed, so no alert', () => {
    const events = [
      fakeEvent({ id: 'e1', phaseOrder: 1, phaseIsActive: false }),
      fakeEvent({ id: 'e2', phaseOrder: 2, phaseIsActive: false }),
    ];
    expect(getActivePhaseFromEvents(events, 0)).toEqual({ status: 'completed' });
  });
});

describe('getMissingPhasesForCompletion', () => {
  it('row at its last milestone → no missing phase', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), fakeEvent({ id: 'e2', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, 1)).toEqual([]);
  });

  it('row one phase behind → lists only that one', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), fakeEvent({ id: 'e2', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, 0)).toEqual([{ value: 'PHASE_1', label: 'Fase 1' }]);
  });

  it('deactivated phases in the interval do not count as missing', () => {
    // They're no longer part of the process: asking for them before concluding would be noise.
    const events = [
      fakeEvent({ id: 'e1', phaseOrder: 0 }),
      fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false }),
      fakeEvent({ id: 'e3', phaseOrder: 2 }),
    ];
    expect(getMissingPhasesForCompletion(events, 0)).toEqual([{ value: 'PHASE_2', label: 'Fase 2' }]);
  });

  it('several events on the same phase count once', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 1 }), fakeEvent({ id: 'e1b', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, 0)).toEqual([{ value: 'PHASE_1', label: 'Fase 1' }]);
  });

  it('group with no phase events → no benchmark, no warning', () => {
    expect(getMissingPhasesForCompletion([fakeEvent({ id: 'po', phaseOrder: null })], 0)).toEqual([]);
  });

  it('row with no phase → all are missing', () => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 }), fakeEvent({ id: 'e2', phaseOrder: 1 })];
    expect(getMissingPhasesForCompletion(events, null).map(p => p.value)).toEqual(['PHASE_0', 'PHASE_1']);
  });
});

describe('getNextPhaseFromEvents', () => {
  const notActive: ActivePhaseResult[] = [{ status: 'no-calendar' }, { status: 'completed' }];

  it.each(notActive)('no active phase ($status) → null', active => {
    const events = [fakeEvent({ id: 'e1', phaseOrder: 0 })];
    expect(getNextPhaseFromEvents(events, active)).toBeNull();
  });

  it('active phase with a later event at a higher order → returns it', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const next = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [active, next];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(next);
  });

  it('the active phase is the last applicable one → null (no next phase to show)', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 2 });
    const events = [fakeEvent({ id: 'e0', phaseOrder: 0 }), active];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toBeNull();
  });

  it('the only later candidate is on a deactivated phase → null, not the deactivated candidate', () => {
    // Regression: a deactivated phase (isActive:false) remains referenced by an
    // existing CalendarEvent but disappears from the catalog (`phase.list` filters
    // isActive:true) — showing it as "next phase" produced an unresolvable label
    // on the frontend side ("—") instead of simply hiding the row.
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const inactiveNext = fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false });
    const events = [active, inactiveNext];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toBeNull();
  });

  it('skips a deactivated candidate and finds the next active one beyond it', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const inactiveNext = fakeEvent({ id: 'e2', phaseOrder: 1, phaseIsActive: false });
    const activeNext = fakeEvent({ id: 'e3', phaseOrder: 2, phaseIsActive: true });
    const events = [active, inactiveNext, activeNext];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(activeNext);
  });

  it('several events on the same active phase do not count as "next" — it takes a higher order', () => {
    const active = fakeEvent({ id: 'e1', phaseOrder: 0 });
    const sameOrderDuplicate = fakeEvent({ id: 'e1b', phaseOrder: 0 });
    const nextPhase = fakeEvent({ id: 'e2', phaseOrder: 1 });
    const events = [active, sameOrderDuplicate, nextPhase];
    expect(getNextPhaseFromEvents(events, { status: 'active', event: active })).toEqual(nextPhase);
  });

  it('the active event is not in the array passed → null (activeIndex not found)', () => {
    const events = [fakeEvent({ id: 'e2', phaseOrder: 2 }), fakeEvent({ id: 'e3', phaseOrder: 3 })];
    // "Active" built separately, with an id that doesn't appear in `events`.
    const foreignActive = { status: 'active' as const, event: fakeEvent({ id: 'not-in-array', phaseOrder: 1 }) };
    expect(getNextPhaseFromEvents(events, foreignActive)).toBeNull();
  });
});

describe('getCompletionDeadlineEvent', () => {
  it('no event → null', () => {
    expect(getCompletionDeadlineEvent([])).toBeNull();
  });

  it('only events with no phase → null (outside the phase mechanism)', () => {
    const phaseless = fakeEvent({ id: 'po-cutoff', phaseOrder: null });
    expect(getCompletionDeadlineEvent([phaseless])).toBeNull();
  });

  it('only events on deactivated phases → null (nothing planned is left to measure)', () => {
    const retired = fakeEvent({ id: 'e1', phaseOrder: 3, phaseIsActive: false });
    expect(getCompletionDeadlineEvent([retired])).toBeNull();
  });

  it('skips the deactivated phases that follow the last active one', () => {
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

const THRESHOLDS = {
  default: {
    bands: [
      { minDaysToDeadline: -9999, maxDaysToDeadline: 0, color: '#B91C1C', label: 'In ritardo', emphasis: 'solid' as const },
      { minDaysToDeadline: 0, maxDaysToDeadline: null, color: '#D97706', label: 'Urgente', emphasis: 'soft' as const },
    ],
  },
  completedBand: { color: '#15803D', label: 'Concluso', emphasis: 'solid' as const },
  completedLateBand: { color: '#B91C1C', label: 'Concluso in ritardo', emphasis: 'solid' as const },
};
const ALERT = { thresholds: THRESHOLDS, timeZone: 'Europe/Rome' };
const NO_WORKING_DAYS = { companyCountryCode: null, holidays: [] };

describe('criticalityFromActivePhase', () => {
  const active = (event: RowEvent): ActivePhaseResult => ({ status: 'active', event });

  it('an all-day deadline is due all its day: count 0, not reached, not late', () => {
    const event = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-02T00:00:00Z'), allDay: true });
    const result = criticalityFromActivePhase('row-1', active(event), null, ALERT, new Date('2026-10-02T21:59:59Z'), null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysToDeadline: 0, reached: false, band: { label: 'Urgente' } });
  });

  it('the same deadline once its day has ended in the business zone is late', () => {
    const event = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-02T00:00:00Z'), allDay: true });
    const result = criticalityFromActivePhase('row-1', active(event), null, ALERT, new Date('2026-10-02T22:00:00Z'), null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysToDeadline: -1, reached: true, band: { label: 'In ritardo' } });
  });

  it('a timed deadline passed earlier today keeps its real count of 0 but is late', () => {
    const event = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-02T08:00:00Z') });
    const result = criticalityFromActivePhase('row-1', active(event), null, ALERT, new Date('2026-10-02T08:01:00Z'), null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysToDeadline: 0, reached: true, band: { label: 'In ritardo' } });
  });

  it('counts from today in the business zone, not in the process zone', () => {
    // 16:30 UTC on the 1st is already the 2nd in Tokyo, still the 1st in UTC, Rome and Los Angeles:
    // code reading the process zone would count 1 under any of those.
    const event = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-02T00:00:00Z'), allDay: true });
    const tokyo = { ...ALERT, timeZone: 'Asia/Tokyo' };
    const result = criticalityFromActivePhase('row-1', active(event), null, tokyo, new Date('2026-10-01T16:30:00Z'), null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysToDeadline: 0, reached: false });
  });

  it('a Sunday deadline seen on Monday counts 0 working days but is late', () => {
    const event = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-04T00:00:00Z'), allDay: true, relevance: 'COMPANY' });
    const italy = { companyCountryCode: 'IT', holidays: [] };
    const result = criticalityFromActivePhase('row-1', active(event), null, ALERT, new Date('2026-10-05T08:00:00Z'), null, italy);
    expect(result).toMatchObject({ daysToDeadline: 0, daysMode: 'working', reached: true, band: { label: 'In ritardo' } });
  });

  it('gives the next phase its own count and reached state', () => {
    const current = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-02T00:00:00Z'), allDay: true });
    const next = fakeEvent({ id: 'e2', phaseOrder: 1, deadline: new Date('2026-10-09T00:00:00Z'), allDay: true });
    const result = criticalityFromActivePhase('row-1', active(current), next, ALERT, new Date('2026-10-02T10:00:00Z'), null, NO_WORKING_DAYS);
    expect(result?.nextPhase).toMatchObject({ daysUntil: 7, reached: false, deadlineDay: '2026-10-09' });
  });

  it('names the deadline and start as calendar dates: all-day its own, timed in the business zone', () => {
    const allDay = fakeEvent({ id: 'e1', phaseOrder: 0, deadline: new Date('2026-10-02T00:00:00Z'), allDay: true });
    expect(criticalityFromActivePhase('row-1', active(allDay), null, ALERT, new Date('2026-09-30T10:00:00Z'), null, NO_WORKING_DAYS))
      .toMatchObject({ deadlineDay: '2026-10-02', eventStartDay: '2026-10-02' });
    // 22:30 UTC on the 2nd is already the 3rd in Rome: the day the countdown counts to.
    const timed = fakeEvent({ id: 'e2', phaseOrder: 0, deadline: new Date('2026-10-02T22:30:00Z') });
    expect(criticalityFromActivePhase('row-1', active(timed), null, ALERT, new Date('2026-09-30T10:00:00Z'), null, NO_WORKING_DAYS))
      .toMatchObject({ deadlineDay: '2026-10-03', eventStartDay: '2026-10-03', daysToDeadline: 3 });
    // A window: the start is the first day, the deadline the day of its end.
    const window = { ...fakeEvent({ id: 'e3', phaseOrder: 0, deadline: new Date('2026-10-01T22:30:00Z') }), endAt: new Date('2026-10-05T08:00:00Z') };
    expect(criticalityFromActivePhase('row-1', active(window), null, ALERT, new Date('2026-09-30T10:00:00Z'), null, NO_WORKING_DAYS))
      .toMatchObject({ eventStartDay: '2026-10-02', deadlineDay: '2026-10-05' });
  });
});

describe('byEventStartDay', () => {
  it('orders by start date, then title and id, so same-day milestones keep one order', () => {
    const entry = (day: string, eventTitle: string, eventId: string) => ({ eventStartDay: parseCalendarDate(day)!, eventTitle, eventId });
    const sorted = [entry('2026-10-03', 'B', '2'), entry('2026-10-02', 'Z', '9'), entry('2026-10-03', 'A', '5'), entry('2026-10-03', 'A', '1')].sort(byEventStartDay);
    expect(sorted.map(e => `${e.eventStartDay}/${e.eventTitle}/${e.eventId}`)).toEqual(['2026-10-02/Z/9', '2026-10-03/A/1', '2026-10-03/A/5', '2026-10-03/B/2']);
  });
});

describe('completionOutcome', () => {
  const deadline = new Date('2026-08-31T00:00:00Z');
  const allDayGate = () => fakeEvent({ id: 'gate-3', phaseOrder: 2, deadline, allDay: true });

  it('without a reference milestone → "on time" band and no invented delta', () => {
    const result = completionOutcome('row-1', new Date('2026-09-10T00:00:00Z'), null, ALERT, null, NO_WORKING_DAYS);
    expect(result).toMatchObject({
      state: 'completed',
      daysVsDeadline: null,
      late: false,
      deadlineDay: null,
      eventId: null,
      band: THRESHOLDS.completedBand,
    });
  });

  it('completed before the deadline → positive delta (early) and "on time" band', () => {
    const result = completionOutcome('row-1', new Date('2026-08-12T00:00:00Z'), allDayGate(), ALERT, null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysVsDeadline: 19, late: false, band: THRESHOLDS.completedBand, deadlineDay: '2026-08-31' });
  });

  it('completed after the deadline → negative delta (late) and "late" band', () => {
    const result = completionOutcome('row-1', new Date('2026-09-10T00:00:00Z'), allDayGate(), ALERT, null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysVsDeadline: -10, late: true, band: THRESHOLDS.completedLateBand });
  });

  it('completed on the all-day deadline itself, up to its last moment in the business zone, is on time', () => {
    const result = completionOutcome('row-1', new Date('2026-08-31T21:59:59.999Z'), allDayGate(), ALERT, null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysVsDeadline: 0, late: false, band: THRESHOLDS.completedBand });
  });

  it('completed exactly when the day ends is late', () => {
    const result = completionOutcome('row-1', new Date('2026-08-31T22:00:00Z'), allDayGate(), ALERT, null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysVsDeadline: -1, late: true, band: THRESHOLDS.completedLateBand });
  });

  it('completed later on the day of a timed deadline is late with a count of 0', () => {
    const timed = fakeEvent({ id: 'gate-3', phaseOrder: 2, deadline: new Date('2026-08-31T08:00:00Z') });
    const result = completionOutcome('row-1', new Date('2026-08-31T15:00:00Z'), timed, ALERT, null, NO_WORKING_DAYS);
    expect(result).toMatchObject({ daysVsDeadline: 0, late: true, band: THRESHOLDS.completedLateBand });
  });
});

describe('filterApplicableEvents', () => {
  it('excludes events of another planning group', () => {
    const mine = fakeEvent({ id: 'e1', planningGroupId: 'pg-1', phaseOrder: 0 });
    const other = fakeEvent({ id: 'e2', planningGroupId: 'pg-2', phaseOrder: 1 });
    expect(filterApplicableEvents([mine, other], 'pg-1')).toEqual([mine]);
  });

  it('orders by ascending phase.order', () => {
    const late = fakeEvent({ id: 'e1', phaseOrder: 2 });
    const early = fakeEvent({ id: 'e2', phaseOrder: 0 });
    const mid = fakeEvent({ id: 'e3', phaseOrder: 1 });
    expect(filterApplicableEvents([late, early, mid], 'pg-1').map(e => e.id)).toEqual(['e2', 'e3', 'e1']);
  });
});
