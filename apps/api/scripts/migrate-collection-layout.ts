/**
 * One-time migration: copy a CollectionLayout (with groups, rows, quotations)
 * from a source DB (RC) to a target DB (prod).
 *
 * Usage:
 *   SOURCE_DATABASE_URL="postgresql://..." TARGET_DATABASE_URL="postgresql://..." \
 *     pnpm --filter @luke/api tsx scripts/migrate-collection-layout.ts
 *
 * The script will prompt for brand code and season code interactively.
 */

import * as readline from 'readline';

import { PrismaClient } from '@prisma/client';

const source = new PrismaClient({ datasources: { db: { url: process.env.SOURCE_DATABASE_URL } } });
const target = new PrismaClient({ datasources: { db: { url: process.env.TARGET_DATABASE_URL } } });

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

async function main() {
  if (!process.env.SOURCE_DATABASE_URL || !process.env.TARGET_DATABASE_URL) {
    console.error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL env vars.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const brandCode  = await ask(rl, 'Brand code (e.g. BRD): ');
  const seasonCode = await ask(rl, 'Season code (e.g. SS26): ');
  rl.close();

  // ── Resolve brand + season in SOURCE ──────────────────────────────────────
  const srcBrand = await source.brand.findFirst({ where: { code: brandCode } });
  if (!srcBrand) { console.error(`Brand '${brandCode}' not found in source.`); process.exit(1); }

  const srcSeason = await source.season.findFirst({ where: { code: seasonCode } });
  if (!srcSeason) { console.error(`Season '${seasonCode}' not found in source.`); process.exit(1); }

  // ── Resolve brand + season in TARGET ──────────────────────────────────────
  const tgtBrand = await target.brand.findFirst({ where: { code: brandCode } });
  if (!tgtBrand) { console.error(`Brand '${brandCode}' not found in target — sync brands first.`); process.exit(1); }

  const tgtSeason = await target.season.findFirst({ where: { code: seasonCode } });
  if (!tgtSeason) { console.error(`Season '${seasonCode}' not found in target — sync seasons first.`); process.exit(1); }

  // ── Fetch full layout from source ─────────────────────────────────────────
  const layout = await source.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId: srcBrand.id, seasonId: srcSeason.id } },
    include: {
      groups: {
        orderBy: { order: 'asc' },
        include: {
          rows: {
            orderBy: { order: 'asc' },
            include: {
              vendor: { select: { navVendorId: true, name: true } },
              quotations: { orderBy: { order: 'asc' } },
            },
          },
        },
      },
    },
  });

  if (!layout) {
    console.error(`No collection layout found for ${brandCode} / ${seasonCode} in source.`);
    process.exit(1);
  }

  // ── Guard: target must not already have this layout ───────────────────────
  const existing = await target.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId: tgtBrand.id, seasonId: tgtSeason.id } },
  });
  if (existing) {
    console.error(`Target already has a layout for ${brandCode} / ${seasonCode}. Aborting.`);
    process.exit(1);
  }

  console.log(`\nMigrating layout: ${layout.groups.length} groups, ` +
    `${layout.groups.reduce((n, g) => n + g.rows.length, 0)} rows`);

  // ── Migrate in a transaction on target ───────────────────────────────────
  await target.$transaction(async tx => {
    const newLayout = await tx.collectionLayout.create({
      data: {
        brandId:          tgtBrand.id,
        seasonId:         tgtSeason.id,
        skuBudget:        layout.skuBudget,
        hiddenColumns:    layout.hiddenColumns ?? undefined,
        availableGenders: layout.availableGenders,
      },
    });

    for (const group of layout.groups) {
      const newGroup = await tx.collectionGroup.create({
        data: {
          collectionLayoutId: newLayout.id,
          name:      group.name,
          order:     group.order,
          skuBudget: group.skuBudget,
        },
      });

      for (const row of group.rows) {
        // Resolve vendor by NAV No_ (stable across DBs)
        let tgtVendorId: string | null = null;
        if (row.vendor?.navVendorId) {
          const v = await tx.vendor.findFirst({ where: { navVendorId: row.vendor.navVendorId } });
          tgtVendorId = v?.id ?? null;
          if (!v) console.warn(`  ⚠ Vendor NAV No_ '${row.vendor.navVendorId}' (${row.vendor.name}) not found in target, row will have no vendor.`);
        }

        // Resolve pricingParameterSet by name/label not available — skip quotation set link
        // (parameter sets are config, not data; link is best-effort)
        const newRow = await tx.collectionLayoutRow.create({
          data: {
            collectionLayoutId: newLayout.id,
            groupId:            newGroup.id,
            order:              row.order,
            gender:             row.gender,
            vendorId:           tgtVendorId,
            line:               row.line,
            article:            row.article,
            status:             row.status,
            skuForecast:        row.skuForecast,
            qtyForecast:        row.qtyForecast,
            productCategory:    row.productCategory,
            strategy:           row.strategy,
            styleStatus:        row.styleStatus,
            progress:           row.progress,
            designer:           row.designer,
            pictureKey:         null, // photos not migrated
            styleNotes:         row.styleNotes,
            materialNotes:      row.materialNotes,
            colorNotes:         row.colorNotes,
            toolingNotes:       row.toolingNotes,
            toolingQuotation:   row.toolingQuotation,
          },
        });

        for (const q of row.quotations) {
          await tx.collectionRowQuotation.create({
            data: {
              rowId:                newRow.id,
              order:                q.order,
              pricingParameterSetId: null, // param set IDs differ across DBs; set manually after
              retailPrice:          q.retailPrice,
              supplierQuotation:    q.supplierQuotation,
              notes:                q.notes,
              sku:                  q.sku,
            },
          });
        }
      }

      console.log(`  ✓ Group '${group.name}': ${group.rows.length} rows`);
    }

    console.log(`\n✅ Layout migrated successfully (new id: ${newLayout.id})`);
    console.log('   ⚠ pricingParameterSetId on quotations set to null — link manually in the UI if needed.');
    console.log('   ⚠ Row pictures not migrated.');
  });

  await source.$disconnect();
  await target.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
