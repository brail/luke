import { describe, it, expect } from 'vitest';

import { DashboardTaskInputSchema, DashboardWidgetsSaveSchema, DashboardWidgetsSchema } from '../dashboard.js';

describe('DashboardTaskInputSchema.dueDate', () => {
  const task = (dueDate: string) => DashboardTaskInputSchema.safeParse({ label: 'Task', dueDate });

  it('takes a calendar day', () => {
    expect(task('2026-03-10').data?.dueDate).toBe('2026-03-10');
  });

  it('refuses an instant for a day', () => {
    expect(task('2026-03-09T23:00:00.000Z').success).toBe(false);
  });
});

describe('DashboardWidgetsSaveSchema', () => {
  const clocks = (timezones: string[]) => [{ id: 'clocks' as const, enabled: true, position: 0, settings: { timezones } }];

  it('refuses a clock zone that is not one, naming where it is', () => {
    const result = DashboardWidgetsSaveSchema.safeParse(clocks(['Europe/Rome', 'Roma']));
    expect(result.error?.issues[0]?.path).toEqual([0, 'settings', 'timezones', 1]);
  });

  it('refuses an empty clock list, in Italian', () => {
    expect(DashboardWidgetsSaveSchema.safeParse(clocks([])).error?.issues[0]?.message).toBe('Almeno un fuso orario');
  });

  it('stores a clock zone in the spelling Intl gives it', () => {
    const parsed = DashboardWidgetsSaveSchema.parse(clocks(['europe/paris']));
    expect(parsed[0]?.settings).toEqual({ timezones: ['Europe/Paris'] });
  });

  it('refuses a forex pair outside the AAA/BBB form', () => {
    expect(DashboardWidgetsSaveSchema.safeParse([{ id: 'forex', enabled: true, position: 0, settings: { pairs: ['usd/cny'] } }]).success).toBe(false);
  });

  it('leaves the settings of the other widgets as they are', () => {
    const widgets = [{ id: 'tasks' as const, enabled: false, position: 3, settings: { any: 1 } }];
    expect(DashboardWidgetsSaveSchema.parse(widgets)).toEqual(widgets);
  });
});

describe('DashboardWidgetsSchema, reading a stored layout back', () => {
  const stored = (settings: unknown) => [{ id: 'clocks', enabled: true, position: 0, settings }];

  // The whole layout is sent back on every save: settings the save would refuse are dropped on
  // read, or one stale value would refuse every later save of the dashboard.
  it.each([
    ['a zone that is not one', { timezones: ['Europe/Rome', 'Roma'] }],
    ['an empty list', { timezones: [] }],
    ['a list that is not one', { timezones: 'Europe/Rome' }],
  ])('drops clock settings holding %s, so the widget shows its defaults', (_, settings) => {
    const [clocksWidget] = DashboardWidgetsSchema.parse(stored(settings));
    expect(clocksWidget).toEqual({ id: 'clocks', enabled: true, position: 0, settings: undefined });
  });

  it('keeps valid settings, in the spelling Intl gives the zones', () => {
    expect(DashboardWidgetsSchema.parse(stored({ timezones: ['europe/paris'] }))[0]?.settings).toEqual({ timezones: ['Europe/Paris'] });
  });

  it('keeps the settings of a widget without a schema of its own', () => {
    const widgets = [{ id: 'tasks', enabled: true, position: 1, settings: { any: 1 } }];
    expect(DashboardWidgetsSchema.parse(widgets)).toEqual(widgets);
  });
});
