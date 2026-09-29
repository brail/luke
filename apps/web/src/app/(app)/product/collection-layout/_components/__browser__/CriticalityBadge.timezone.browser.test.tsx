import { describe, expect, test, vi } from 'vitest';

import { parseCalendarDate, type CalendarDate } from '@luke/core';

import { formatCompletionTooltip, formatCriticalityTooltip } from '../CriticalityBadge';

// The badge component queries through `lib/trpc`; the tooltip formatters under test do not.
vi.mock('../../../../../../lib/trpc', () => ({ trpc: {} }));

/**
 * The criticality tooltips under each zone of `vitest.browser.timezone.config.mts`. The server
 * names the deadline as the calendar date its countdown runs to, in the business zone; the
 * browser, in whatever zone it is, must print that date as it is — reading an instant here would
 * show a viewer west of the business zone the day before the one the count is about.
 */

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function date(s: string): CalendarDate {
  const parsed = parseCalendarDate(s);
  if (!parsed) throw new Error(`bad fixture date ${s}`);
  return parsed;
}

const COMMON = { eventTitle: 'Consegna', daysMode: 'calendar' as const, relevantCountryCodes: [] };

describe(`criticality tooltips (${ZONE})`, () => {
  test('an active deadline prints the server’s calendar date', () => {
    const tooltip = formatCriticalityTooltip({ ...COMMON, daysToDeadline: 3, reached: false, deadlineDay: date('2026-10-03') });
    expect(tooltip).toBe('3 gg di calendario alla scadenza — «Consegna»: 03/10/2026');
  });

  test('a completion prints the deadline date, or says there is no milestone', () => {
    const completedAt = new Date(2026, 9, 1, 12, 0).toISOString();
    const withMilestone = formatCompletionTooltip({ ...COMMON, completedAt, daysVsDeadline: 2, late: false, deadlineDay: date('2026-10-03') });
    expect(withMilestone).toContain('03/10/2026');
    const without = formatCompletionTooltip({ ...COMMON, completedAt, daysVsDeadline: null, late: false, deadlineDay: null, eventTitle: null });
    expect(without).toBe('Conclusa il 01/10/2026 — nessuna milestone di riferimento');
  });
});
