/**
 * The deadline notice rules of `milestoneDeadlineScheduler.ts`, pure halves:
 * - `deadlineState`: measured on the deadline (`endAt ?? startAt`) and read in the business zone —
 *   an all-day deadline is due all its day and reached once the day has ended; "oggi/domani/tra 2
 *   giorni" count calendar days to the deadline's day; an overdue one is notified on days 0–2 after
 *   the day it is reached and once more on days 3–5, each stage one occurrence.
 * - `milestoneNotice` / `phaseOverdueNotice`: the kind each notice is muted by, and its text.
 */

import { describe, it, expect } from 'vitest';

import { deadlineState, milestoneNotice, phaseOverdueNotice, type DeadlineState } from '../src/lib/milestoneDeadlineScheduler';

const ROME = 'Europe/Rome';
// 2026-10-02 10:00 in Rome.
const NOW = new Date('2026-10-02T08:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const allDay = (day: string, endDay?: string) => ({
  startAt: new Date(`${day}T00:00:00.000Z`),
  endAt: endDay ? new Date(`${endDay}T00:00:00.000Z`) : null,
  allDay: true,
});
const EVENT = { id: 'e1', title: 'Consegna', context: 'Brand · Stagione' };
const OVERDUE: DeadlineState = { type: 'overdue', occurrence: 'overdue:2026-10-02:0' };

describe('deadlineState', () => {
  it.each([
    ['2026-10-02', 0],
    ['2026-10-03', 1],
    ['2026-10-04', 2],
  ])('an all-day deadline on %s is due in %i days', (day, daysLeft) => {
    expect(deadlineState(allDay(day), NOW, ROME)).toEqual({ type: 'upcoming', daysLeft, occurrence: `upcoming:${day}:${daysLeft}` });
  });

  it('says nothing three days ahead', () => {
    expect(deadlineState(allDay('2026-10-05'), NOW, ROME)).toBeNull();
  });

  // An all-day deadline is reached the day after it: 2026-10-01 is reached on 2026-10-02, day 0.
  it.each([
    ['2026-10-01', 'overdue:2026-10-02:0'],
    ['2026-09-29', 'overdue:2026-09-30:0'],
    ['2026-09-28', 'overdue:2026-09-29:3'],
    ['2026-09-26', 'overdue:2026-09-27:3'],
  ])('an all-day deadline on %s is overdue as %s', (day, occurrence) => {
    expect(deadlineState(allDay(day), NOW, ROME)).toEqual({ type: 'overdue', occurrence });
  });

  it('says nothing from the sixth day after the deadline is reached', () => {
    expect(deadlineState(allDay('2026-09-25'), NOW, ROME)).toBeNull();
  });

  it('keeps one occurrence through a stage, and starts another with the next', () => {
    const at = (days: number) => deadlineState(allDay('2026-10-01'), new Date(NOW.getTime() + days * DAY_MS), ROME);
    expect(at(2)).toEqual(at(0));
    expect(at(3)).not.toEqual(at(2));
    expect(at(5)).toEqual(at(3));
    expect(at(6)).toBeNull();
  });

  it('measures a window on its end, not its start', () => {
    expect(deadlineState(allDay('2026-09-25', '2026-10-04'), NOW, ROME)).toMatchObject({ type: 'upcoming', daysLeft: 2 });
  });

  it('a timed deadline passed earlier today is overdue from today', () => {
    const timed = { startAt: new Date('2026-10-02T07:00:00.000Z'), endAt: null, allDay: false };
    expect(deadlineState(timed, NOW, ROME)).toEqual({ type: 'overdue', occurrence: 'overdue:2026-10-02:0' });
  });
});

describe('milestoneNotice', () => {
  it.each([
    [0, 'oggi'],
    [1, 'domani'],
    [2, 'tra 2 giorni'],
  ])('an upcoming deadline %i days away is muted as upcoming and says "%s"', (daysLeft, label) => {
    expect(milestoneNotice(EVENT, { type: 'upcoming', daysLeft, occurrence: 'u' })).toMatchObject({
      eventKey: 'CALENDAR_DEADLINE_UPCOMING',
      title: 'Milestone in scadenza',
      message: `"Consegna" scade ${label} · Brand · Stagione`,
      occurrence: 'u',
    });
  });

  it('an overdue deadline is muted as overdue, and links to its event', () => {
    expect(milestoneNotice(EVENT, OVERDUE)).toMatchObject({
      eventKey: 'CALENDAR_DEADLINE_OVERDUE',
      title: 'Milestone scaduta',
      message: '"Consegna" è scaduta senza essere completata · Brand · Stagione',
      link: '/calendar?event=e1',
      occurrence: 'overdue:2026-10-02:0',
    });
  });
});

describe('phaseOverdueNotice', () => {
  it('names a single late row, muted as phase overdue', () => {
    expect(phaseOverdueNotice(EVENT, ['Linea A'], OVERDUE)).toEqual({
      eventKey: 'CALENDAR_PHASE_OVERDUE',
      title: 'Fase scaduta',
      message: '"Linea A" non ha completato "Consegna" entro la scadenza · Brand · Stagione',
      link: '/product/collection-layout',
      data: { eventId: 'e1', type: 'phase_overdue' },
      // Apart from the event's own overdue notice, on the same occurrences.
      occurrence: 'phase_overdue:2026-10-02:0',
    });
  });

  it('counts the late rows, then names the first ten', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `L${i + 1}`);
    expect(phaseOverdueNotice(EVENT, lines, OVERDUE).message).toBe(
      '12 righe non hanno completato "Consegna" entro la scadenza · Brand · Stagione: L1, L2, L3, L4, L5, L6, L7, L8, L9, L10 e altre 2',
    );
  });
});
