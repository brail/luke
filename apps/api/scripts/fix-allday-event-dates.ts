/**
 * fix-allday-event-dates.ts
 *
 * Retroactively corrects CalendarEvent.startAt/endAt for allDay=true events created with the
 * CalendarEventDialog.tsx bug (local date with no offset → new Date() interprets it as local
 * time instead of UTC midnight, causing a one-day rollback once converted to UTC).
 * Recomputes every row as UTC midnight of the current local calendar day — an idempotent
 * operation: rows already correct (UTC midnight) are left unchanged, corrupted ones have
 * the day the user originally picked restored (the same auto-correction mechanism that
 * already makes Luke's UI display correctly today).
 *
 * Requires TZ=Europe/Rome in the process (set by the npm script, not here in the file: static
 * imports run before any top-level statement of this module).
 *
 * Usage:
 *   pnpm --filter @luke/api db:fix-allday-dates [--dry-run] [--no-sync]
 */

import { getConfiguredGoogleClient, reconcileCalendar } from '../src/services/googleCalendarSync.service.js';

import { createScriptPrismaClient } from './lib/prisma.js';


function utcMidnightOfLocalDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const noSync = process.argv.includes('--no-sync');

  if (process.env.TZ !== 'Europe/Rome') {
    console.error('❌ Lo script richiede TZ=Europe/Rome (vedi lo script npm "db:fix-allday-dates").');
    process.exit(1);
  }

  const prisma = createScriptPrismaClient();

  try {
    const events = await prisma.calendarEvent.findMany({
      where: { allDay: true },
      select: { id: true, calendarId: true, startAt: true, endAt: true },
    });

    console.log(`🔍 ${events.length} eventi allDay trovati.\n`);

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

    console.log(`\n✅ ${toFix.length} evento/i ${dryRun ? 'da correggere' : 'corretti'} su ${events.length} scansionati.`);

    if (dryRun || noSync) return;

    const affectedCalendarIds = new Set(toFix.map(e => e.calendarId));
    if (affectedCalendarIds.size === 0) {
      console.log('Nessun calendario da risincronizzare.');
      return;
    }

    const creds = await getConfiguredGoogleClient(prisma);
    if (!creds) {
      console.log('\n⚠️  Integrazione Google Calendar non configurata — correzione DB applicata, nessun resync eseguito.');
      return;
    }

    console.log(`\n🔄 Risincronizzo ${affectedCalendarIds.size} calendario/i verso Google...\n`);
    const logger = { info: console.log, error: console.error, warn: console.warn };
    for (const calendarId of affectedCalendarIds) {
      const result = await reconcileCalendar(calendarId, prisma, logger);
      console.log(`   ${calendarId}: ${result.synced} sincronizzati, ${result.errors} errori`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
