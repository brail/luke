import { describe, expect, it } from 'vitest';

import { NAV_SYNC_ENTITIES, NavSyncScheduleInputSchema } from '../nav.js';

// The API's `saveSyncSchedule` input and the settings page's interval check, in one schema.
describe('NavSyncScheduleInputSchema', () => {
  const schedule = (intervalMinutes: number, entity = 'vendor') => NavSyncScheduleInputSchema.safeParse({ entity, autoSyncEnabled: true, intervalMinutes });

  it.each([1, 30, 1440])('accepts %i minutes', minutes => {
    expect(schedule(minutes).success).toBe(true);
  });

  it.each([0, 1441, 1.5, Number.NaN])('refuses %d minutes with the page’s message', minutes => {
    expect(schedule(minutes).error?.issues[0]?.message).toBe('Inserisci un numero intero di minuti tra 1 e 1440');
  });

  it('accepts every filter entity and nothing else', () => {
    for (const entity of NAV_SYNC_ENTITIES) expect(schedule(30, entity).success).toBe(true);
    expect(schedule(30, 'customer').success).toBe(false);
  });
});
