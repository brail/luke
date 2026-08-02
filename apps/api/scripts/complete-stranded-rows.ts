/**
 * complete-stranded-rows.ts
 *
 * Chiude le righe di collection layout rimaste **aperte su una fase disattivata**: dati anteriori
 * al motore di fasi/alert, che oggi non sono misurati da nessuno (nessuna milestone applicabile
 * oltre la loro fase) ma continuano a risultare "in lavorazione". Restano anche l'unico ostacolo
 * al guard di `phase.remove`, che rifiuta di ritirare una fase con righe aperte sopra.
 *
 * `completedAt` non viene messo a "adesso": queste righe hanno smesso di muoversi tempo fa. Usa
 * l'ultima transizione di fase registrata (`CollectionRowPhaseHistory.reachedAt`), che è il momento
 * in cui la riga è entrata nella fase dove si è fermata; in mancanza di storico ripiega su
 * `updatedAt`. Così anche il tempo totale al completamento resta un numero sensato invece di
 * inglobare mesi di inattività.
 *
 * Idempotente: le righe già concluse non vengono toccate (il filtro è `completedAt: null`).
 *
 * Uso:
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
