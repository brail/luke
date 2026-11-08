/**
 * harden-google-calendar-acl.ts
 *
 * Runs one `reconcileGoogleReaders` pass now: every provisioned Google calendar gets its readers
 * brought back to the current rule (admins, plus members of a team holding both its function and
 * its brand) and its domain rule pinned read-only. The API already runs the same pass shortly
 * after it starts and every 10 minutes (`googleReaderScheduler.ts`); this is for an operator who
 * wants it immediately.
 *
 * Usage:
 *   pnpm --filter @luke/api db:harden-google-acl
 */

import { reconcileGoogleReaders } from '../src/services/googleCalendarSync.service.js';

import { createScriptPrismaClient } from './lib/prisma.js';

const logger = {
  info: (obj: unknown, msg?: string) => console.log(msg ?? '', obj),
  warn: (obj: unknown, msg?: string) => console.warn(`⚠️  ${msg ?? ''}`, obj),
  error: (obj: unknown, msg?: string) => console.error(`❌ ${msg ?? ''}`, obj),
};

async function main() {
  const prisma = createScriptPrismaClient();
  try {
    const result = await reconcileGoogleReaders(prisma, logger);
    if (!result) {
      console.error('❌ Google credentials not configured — nothing to do.');
      process.exit(1);
    }
    if (result.failed > 0) process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
