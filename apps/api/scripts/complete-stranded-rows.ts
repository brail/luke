/**
 * complete-stranded-rows.ts
 *
 * Closes collection layout rows left **open on a deactivated phase**: data predating
 * the phase/alert engine, which today isn't measured by anything (no applicable milestone
 * past their phase) but still shows up as "in progress". They're also the one remaining obstacle
 * to `phase.remove`'s guard, which refuses to retire a phase with open rows still on it.
 *
 * `completedAt` isn't set to "now": these rows stopped moving a while ago. It uses
 * the last recorded phase transition (`CollectionRowPhaseHistory.reachedAt`), which is the moment
 * the row entered the phase it got stuck on; absent any history, it falls back to
 * `updatedAt`. This way the total time to completion also stays a sensible number instead of
 * absorbing months of inactivity.
 *
 * Idempotent: already-completed rows aren't touched (the filter is `completedAt: null`).
 *
 * Usage:
 *   pnpm --filter @luke/api db:complete-stranded-rows [--dry-run]
 */

import { createScriptPrismaClient } from './lib/prisma';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = createScriptPrismaClient();

  try {
    const rows = await prisma.collectionLayoutRow.findMany({
      where: { completedAt: null, phase: { isActive: false } },
      select: {
        id: true,
        line: true,
        updatedAt: true,
        phase: { select: { label: true } },
        collectionLayout: {
          select: { brand: { select: { code: true } }, season: { select: { code: true } } },
        },
        phaseHistory: {
          select: { reachedAt: true },
          orderBy: { reachedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (rows.length === 0) {
      console.log('✅ Nessuna riga aperta su fasi disattivate: niente da fare.');
      return;
    }

    console.log(`🔍 ${rows.length} righe aperte su fasi disattivate.\n`);

    let updated = 0;
    for (const row of rows) {
      const completedAt = row.phaseHistory[0]?.reachedAt ?? row.updatedAt;
      const scope = `${row.collectionLayout.brand.code}/${row.collectionLayout.season.code}`;
      const source = row.phaseHistory[0] ? 'storico fase' : 'updatedAt';
      console.log(
        `  ${dryRun ? '[dry-run] ' : ''}${scope} · "${row.line}" · ${row.phase?.label ?? '—'} → conclusa il ${completedAt.toISOString().slice(0, 10)} (${source})`
      );

      if (!dryRun) {
        await prisma.collectionLayoutRow.update({ where: { id: row.id }, data: { completedAt } });
        updated++;
      }
    }

    console.log(
      dryRun
        ? `\n🧪 Dry run: nessuna scrittura. ${rows.length} righe verrebbero concluse.`
        : `\n✅ ${updated} righe concluse.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
