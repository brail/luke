/**
 * harden-google-calendar-acl.ts
 *
 * Riapplica retroattivamente a tutti i GoogleCalendarBinding già provisioned:
 *  - syncCalendarReaders() con la lista email corrente scoped per funzione (team
 *    membership + admin) — i calendar creati prima della restrizione per-funzione
 *    hanno ancora l'ACL vecchia (tutti gli utenti attivi, senza filtro)
 *  - enforceDomainReadOnly() — downgrade della regola di dominio a freeBusyReader
 *
 * Entrambi gli hardening scattano solo al momento della creazione di un nuovo
 * binding — i calendar creati prima non ne beneficiano finché non gira questo
 * script una tantum.
 *
 * Uso:
 *   pnpm --filter @luke/api db:harden-google-acl
 */

import { PrismaClient } from '@prisma/client';

import { enforceDomainReadOnly, syncCalendarReaders } from '@luke/calendar';

import { getConfiguredGoogleClient, getAllowedEmailsForFunction } from '../src/services/googleCalendarSync.service.js';

async function main() {
  const prisma = new PrismaClient();

  try {
    const creds = await getConfiguredGoogleClient(prisma);
    if (!creds) {
      console.error('❌ Integrazione Google Calendar non configurata o disabilitata — nulla da fare.');
      process.exit(1);
    }

    const bindings = await prisma.googleCalendarBinding.findMany({
      where: { isProvisioned: true },
      include: { companyFunction: { select: { name: true } }, seasonCalendar: { select: { brandId: true, seasonId: true } } },
    });

    console.log(`🔍 ${bindings.length} calendar Google provisioned trovati.\n`);

    let hardened = 0;
    let errors = 0;

    // Same companyFunctionId repeats across every season calendar (one binding per
    // season × function) — cache the reader list per function instead of re-querying it
    // once per binding.
    const emailsByFunction = new Map<string, Promise<string[]>>();
    const allowedEmailsFor = (companyFunctionId: string): Promise<string[]> => {
      let cached = emailsByFunction.get(companyFunctionId);
      if (!cached) {
        cached = getAllowedEmailsForFunction(companyFunctionId, prisma);
        emailsByFunction.set(companyFunctionId, cached);
      }
      return cached;
    };

    for (const b of bindings) {
      try {
        const allowedEmails = await allowedEmailsFor(b.companyFunctionId);
        await syncCalendarReaders(b.googleCalendarId, allowedEmails);
        await enforceDomainReadOnly(b.googleCalendarId);
        hardened++;
        console.log(`✅ ${b.companyFunction.name} (${b.googleCalendarId}) — ${allowedEmails.length} reader`);
      } catch (err) {
        errors++;
        console.error(`❌ ${b.companyFunction.name} (${b.googleCalendarId}):`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`\n✅ Completato: ${hardened} calendar aggiornati, ${errors} errori.`);
    if (errors > 0) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
