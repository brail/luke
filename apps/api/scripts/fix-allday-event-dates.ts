/**
 * fix-allday-event-dates.ts
 *
 * Retroactively corrects CalendarEvent.startAt/endAt for allDay=true events created with the
 * CalendarEventDialog.tsx bug (local date with no offset → new Date() interprets it as local
 * time instead of UTC midnight, causing a one-day rollback once converted to UTC).
 * Recomputes every row as UTC midnight of the current local calendar day — an idempotent
 * operation: rows already correct (UTC midnight) are left unchanged, corrupted ones have
 * the day a user in Rome originally picked restored. The web reads an all-day value as its
 * stored UTC date, so until this runs such a row shows, and is saved back as, the day before.
 *
 * Requires TZ=Europe/Rome in the process (set by the npm script, not here in the file: static
 * imports run before any top-level statement of this module).
 *
 * Usage:
 *   pnpm --filter @luke/api db:fix-allday-dates [--dry-run] [--no-sync]
 */

import { parseArgs } from 'util';

import { getConfiguredGoogleClient, reconcileCalendar } from '../src/services/googleCalendarSync.service.js';

import { createScriptPrismaClient } from './lib/prisma.js';


function utcMidnightOfLocalDay(d: Date): Date {
  // eslint-disable-next-line @luke/no-implicit-zone-date -- the 2.1 → 3.0 repair reads the local day in the zone its command line sets (TZ), by design (ADR-035)
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

async function main() {
  const { 'dry-run': dryRun, 'no-sync': noSync } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false }, 'no-sync': { type: 'boolean', default: false } },
  }).values;

  if (process.env.TZ !== 'Europe/Rome') {
    console.error('❌ The script requires TZ=Europe/Rome (see the npm script "db:fix-allday-dates").');
    process.exit(1);
  }

  const prisma = createScriptPrismaClient();

  try {
    const events = await prisma.calendarEvent.findMany({
      where: { allDay: true },
      select: { id: true, calendarId: true, startAt: true, endAt: true },
    });

    console.log(`🔍 ${events.length} allDay events found.\n`);

    const toFix = events
      .map(e => {
        const fixedStart = utcMidnightOfLocalDay(e.startAt);
        const fixedEnd = e.endAt ? utcMidnightOfLocalDay(e.endAt) : null;
        const startDiffers = fixedStart.getTime() !== e.startAt.getTime();
        const endDiffers = (fixedEnd?.getTime() ?? null) !== (e.endAt?.getTime() ?? null);
        return startDiffers || endDiffers ? { id: e.id, calendarId: e.calendarId, oldStart: e.startAt, fixedStart, fixedEnd } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    for (const e of toFix) {
      console.log(`${dryRun ? '🔎' : '✅'} ${e.id}: ${e.oldStart.toISOString()} → ${e.fixedStart.toISOString()}`);
    }

    if (!dryRun) {
      await Promise.all(toFix.map(e => prisma.calendarEvent.update({
        where: { id: e.id },
        data: { startAt: e.fixedStart, endAt: e.fixedEnd },
      })));
    }

    console.log(`\n✅ ${toFix.length} event(s) ${dryRun ? 'to fix' : 'fixed'} out of ${events.length} scanned.`);

    if (dryRun || noSync) return;

    const affectedCalendarIds = new Set(toFix.map(e => e.calendarId));
    if (affectedCalendarIds.size === 0) {
      console.log('No calendar to resync.');
      return;
    }

    const creds = await getConfiguredGoogleClient(prisma);
    if (!creds) {
      console.log('\n⚠️  Google Calendar integration not configured — DB fix applied, no resync run.');
      return;
    }

    console.log(`\n🔄 Resyncing ${affectedCalendarIds.size} calendar(s) to Google...\n`);
    const logger = { info: console.log, error: console.error, warn: console.warn };
    for (const calendarId of affectedCalendarIds) {
      const result = await reconcileCalendar(calendarId, prisma, logger);
      console.log(`   ${calendarId}: ${result.synced} synced, ${result.errors} errors`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
