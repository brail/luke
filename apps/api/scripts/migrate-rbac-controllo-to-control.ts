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

import { createScriptPrismaClient } from './lib/prisma.js';

const CONFIG_KEY = 'rbac.sectionAccessDefaults';
const OLD_KEY = 'product.controllo';
const NEW_KEY = 'product.control';

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = createScriptPrismaClient();

  try {
    const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (!row) {
      console.log(`ℹ️  No '${CONFIG_KEY}' row found — nothing to migrate.`);
      return;
    }

    let parsed: Record<string, Record<string, string>>;
    try {
      parsed = JSON.parse(row.value);
    } catch (err) {
      console.error(`❌ The value of '${CONFIG_KEY}' is not valid JSON, aborting without writing:`, err);
      process.exit(1);
    }

    const changedRoles: string[] = [];
    for (const [role, sectionMap] of Object.entries(parsed)) {
      if (!sectionMap || !(OLD_KEY in sectionMap)) continue;

      const oldValue = sectionMap[OLD_KEY];
      if (NEW_KEY in sectionMap) {
        console.warn(
          `⚠️  ${role}: '${NEW_KEY}' already present (value '${sectionMap[NEW_KEY]}') — discarding '${OLD_KEY}' ('${oldValue}') without overwriting`
        );
      } else {
        sectionMap[NEW_KEY] = oldValue;
        console.log(`${role}: '${OLD_KEY}' ('${oldValue}') → '${NEW_KEY}' ('${oldValue}')`);
      }
      delete sectionMap[OLD_KEY];
      changedRoles.push(role);
    }

    if (changedRoles.length === 0) {
      console.log(`ℹ️  No '${OLD_KEY}' key found — already migrated or never set.`);
      return;
    }

    console.log(
      `\n${apply ? '✅' : '🔎 DRY RUN —'} ${changedRoles.length} role(s) to update: ${changedRoles.join(', ')}`
    );

    if (!apply) {
      console.log('Nothing written — run again with --apply to apply.');
      return;
    }

    await prisma.appConfig.update({
      where: { key: CONFIG_KEY },
      data: { value: JSON.stringify(parsed) },
    });

    console.log(`✅ Written to '${CONFIG_KEY}'.`);
    console.log(
      '⚠️  In-memory RBAC cache not invalidated by this script (a process separate from the API) — ' +
        'restart the API processes or wait up to 60s before checking.'
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
