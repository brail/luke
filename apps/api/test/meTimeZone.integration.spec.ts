/**
 * `User.timezone` on the `me` router: both write paths accept only an IANA zone, `me.get` answers
 * with the zone the server actually renders in (the business zone for a legacy invalid row), and
 * the daily greeting picks its hour in that zone rather than a hard-coded Europe/Rome.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { deleteConfig, getConfig, saveConfig } from '../src/lib/configManager';
import { getTimeBasedGreeting } from '../src/lib/greetingPhrases';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The greeting a reader in `timeZone` should get right now. */
function greetingIn(timeZone: string): string {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  return getTimeBasedGreeting(Number(hour));
}

describe('User.timezone on write', () => {
  it('updateTimezone refuses a non-IANA zone and stores a valid one', async () => {
    const { user, session } = await createTestUser('viewer');
    const caller = createCallerWithSession(session);

    await expect(caller.me.updateTimezone({ timezone: '+01:00' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller.me.updateTimezone({ timezone: 'Asia/Shanghai' });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).timezone).toBe('Asia/Shanghai');
  });

  it('updateProfile refuses a non-IANA zone', async () => {
    const { session } = await createTestUser('viewer');
    await expect(
      createCallerWithSession(session).me.updateProfile({
        firstName: 'Mario', lastName: 'Rossi', locale: 'it-IT', timezone: 'Mars/Olympus',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('me.get with a legacy invalid zone', () => {
  it('answers with the business zone, and saving the profile it loaded repairs the row', async () => {
    const { user, session } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { timezone: 'Mars/Olympus' } });
    const caller = createCallerWithSession(session);

    // A business zone other than the registry default, so a hard-coded Europe/Rome cannot pass.
    // Integration files run one at a time (`fileParallelism: false`); the row is restored below.
    const previous = await getConfig(prisma, 'app.defaultTimezone', false);
    await saveConfig(prisma, 'app.defaultTimezone', 'Asia/Tokyo');
    try {
      const profile = await caller.me.get();
      expect(profile.timezone).toBe('Asia/Tokyo');

      // The profile form sends back what `me.get` gave it; with the raw value this save would fail.
      await caller.me.updateProfile({
        firstName: 'Mario', lastName: 'Rossi', locale: profile.locale, timezone: profile.timezone,
      });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).timezone).toBe('Asia/Tokyo');
    } finally {
      if (previous === null) await deleteConfig(prisma, 'app.defaultTimezone');
      else await saveConfig(prisma, 'app.defaultTimezone', previous);
    }
  });
});

describe('daily greeting', () => {
  it("picks the hour in each reader's zone", async () => {
    // Tokyo and Los Angeles are 16 h apart: at any instant at least one of them lands in a
    // different bucket from Europe/Rome, so a hard-coded zone fails one of the two.
    for (const timezone of ['Asia/Tokyo', 'America/Los_Angeles']) {
      const { session } = await createTestUser('viewer');
      const caller = createCallerWithSession(session);
      await caller.me.updateTimezone({ timezone });
      await caller.me.updateGreetingPreference({ enabled: true });

      // Only around the greeting call: `createTestUser` draws its unique suffix from Math.random too.
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.1); // the local "fact" branch: no Quotable fetch
      const before = greetingIn(timezone);
      const result = await caller.me.getDailyGreeting();
      const after = greetingIn(timezone);
      random.mockRestore();

      expect(result.enabled).toBe(true);
      // `before`/`after` bracket the call, so a bucket boundary crossed mid-test cannot flake it.
      expect([before, after]).toContain(result.enabled ? result.greeting : null);
    }
  });
});
