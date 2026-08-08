/**
 * migrate-rbac-controllo-to-control.ts
 *
 * The RBAC section key `product.controllo` was renamed to `product.control`
 * in code (packages/core/src/schemas/rbac.ts). If an admin ever set a runtime
 * override for that section via the settings UI, it's persisted in the
 * `rbac.sectionAccessDefaults` AppConfig row under the old key — the read
 * path does a bare JSON.parse with no enum validation, so a stale key there
 * doesn't error, it just silently becomes inert dead data. This script moves
 * the value from the old key to the new one so the override survives.
 *
 * Idempotent: safe to re-run after a successful --apply (finds nothing left
 * to migrate the second time). Does NOT call invalidateRbacCache() — that
 * cache is an in-memory Map per API process (see
 * packages/core/src/server/rbacConfig.ts, 60s TTL) and this script runs
 * out-of-process, so it can't reach it. Restart the API replicas (or wait up
 * to 60s) after applying, then spot-check the admin panel.
 *
 * Usage:
 *   pnpm --filter @luke/api db:migrate-rbac-section-key            # dry run
 *   pnpm --filter @luke/api db:migrate-rbac-section-key --apply    # write
 */

import { createScriptPrismaClient } from './lib/prisma';

const CONFIG_KEY = 'rbac.sectionAccessDefaults';
const OLD_KEY = 'product.controllo';
const NEW_KEY = 'product.control';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = createScriptPrismaClient();

  try {
    const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (!row) {
      console.log(`ℹ️  Nessuna riga '${CONFIG_KEY}' trovata — nulla da migrare.`);
      return;
    }

    let parsed: Record<string, Record<string, string>>;
    try {
      parsed = JSON.parse(row.value);
    } catch (err) {
      console.error(`❌ Valore di '${CONFIG_KEY}' non è JSON valido, abort senza scrivere:`, err);
      process.exit(1);
    }

    const changedRoles: string[] = [];
    for (const [role, sectionMap] of Object.entries(parsed)) {
      if (!sectionMap || !(OLD_KEY in sectionMap)) continue;

      const oldValue = sectionMap[OLD_KEY];
      if (NEW_KEY in sectionMap) {
        console.warn(
          `⚠️  ${role}: '${NEW_KEY}' già presente (valore '${sectionMap[NEW_KEY]}') — scarto '${OLD_KEY}' ('${oldValue}') senza sovrascrivere`
        );
      } else {
        sectionMap[NEW_KEY] = oldValue;
        console.log(`${role}: '${OLD_KEY}' ('${oldValue}') → '${NEW_KEY}' ('${oldValue}')`);
      }
      delete sectionMap[OLD_KEY];
      changedRoles.push(role);
    }

    if (changedRoles.length === 0) {
      console.log(`ℹ️  Nessuna chiave '${OLD_KEY}' trovata — già migrato o mai impostato.`);
      return;
    }

    console.log(
      `\n${apply ? '✅' : '🔎 DRY RUN —'} ${changedRoles.length} ruolo/i da aggiornare: ${changedRoles.join(', ')}`
    );

    if (!apply) {
      console.log('Nessuna scrittura eseguita — rilanciare con --apply per applicare.');
      return;
    }

    await prisma.appConfig.update({
      where: { key: CONFIG_KEY },
      data: { value: JSON.stringify(parsed) },
    });

    console.log(`✅ Scritto su '${CONFIG_KEY}'.`);
    console.log(
      "⚠️  Cache RBAC in-memory non invalidata da questo script (processo separato dall'API) — " +
        'riavviare i processi API oppure attendere fino a 60s prima di verificare.'
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
