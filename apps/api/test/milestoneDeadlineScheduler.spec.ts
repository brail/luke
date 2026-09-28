/**
 * The milestone notification rule (`milestoneNotice`): measured on the deadline (`endAt ?? startAt`)
 * and read in the business zone — an all-day deadline is due all its day and overdue once the day
 * has ended; "oggi/domani/tra 2 giorni" count calendar days to the deadline's day.
 */

import { describe, it, expect } from 'vitest';

import { milestoneNotice } from '../src/lib/milestoneDeadlineScheduler';

const ROME = 'Europe/Rome';
// 2026-10-02 10:00 in Rome.
const NOW = new Date('2026-10-02T08:00:00.000Z');
const allDay = (day: string, endDay?: string) => ({
  title: 'Consegna',
  startAt: new Date(`${day}T00:00:00.000Z`),
  endAt: endDay ? new Date(`${endDay}T00:00:00.000Z`) : null,
  allDay: true,
});

describe('milestoneNotice', () => {
  it.each([
    ['2026-10-02', 'oggi'],
    ['2026-10-03', 'domani'],
    ['2026-10-04', 'tra 2 giorni'],
  ])('an all-day deadline on %s is due %s', (day, label) => {
    expect(milestoneNotice(allDay(day), NOW, ROME)).toEqual({ type: 'upcoming', message: `"Consegna" scade ${label}` });
  });

  it('says nothing three days ahead', () => {
    expect(milestoneNotice(allDay('2026-10-05'), NOW, ROME)).toBeNull();
  });

  it("is overdue once yesterday's all-day deadline has ended, for three days", () => {
    expect(milestoneNotice(allDay('2026-10-01'), NOW, ROME)).toMatchObject({ type: 'overdue' });
    expect(milestoneNotice(allDay('2026-09-28'), NOW, ROME)).toBeNull();
  });

  it('measures a window on its end, not its start', () => {
    expect(milestoneNotice(allDay('2026-09-25', '2026-10-04'), NOW, ROME)).toMatchObject({
      type: 'upcoming',
      message: '"Consegna" scade tra 2 giorni',
    });
  });

  it('a timed deadline passed earlier today is overdue', () => {
    const timed = { title: 'Consegna', startAt: new Date('2026-10-02T07:00:00.000Z'), endAt: null, allDay: false };
    expect(milestoneNotice(timed, NOW, ROME)).toMatchObject({ type: 'overdue' });
  });
});
