/**
 * fix-allday-event-dates.ts
 *
 * Corregge retroattivamente CalendarEvent.startAt/endAt per eventi allDay=true creati con il bug
 * di CalendarEventDialog.tsx (data locale senza offset → new Date() la interpreta come orario
 * locale invece di UTC midnight, causando un rollback di un giorno una volta convertita in UTC).
 * Ricalcola ogni riga come UTC midnight del giorno di calendario locale corrente — operazione
 * idempotente: sulle righe già corrette (UTC midnight) non cambia nulla, su quelle corrotte
 * ripristina il giorno originariamente scelto dall'utente (stesso meccanismo di auto-correzione
 * che rende l'UI di Luke già visivamente corretta oggi).
 *
 * Richiede TZ=Europe/Rome nel processo (impostato dallo script npm, non qui nel file: gli import
 * statici vengono eseguiti prima di qualunque istruzione top-level di questo modulo).
 *
 * Uso:
 *   pnpm --filter @luke/api db:fix-allday-dates [--dry-run] [--no-sync]
 */

import { PrismaClient } from '@prisma/client';

import { getConfiguredGoogleClient, reconcileCalendar } from '../src/services/googleCalendarSync.service.js';

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

  const prisma = new PrismaClient();

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
