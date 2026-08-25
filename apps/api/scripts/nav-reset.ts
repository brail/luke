/**
 * nav-reset.ts
 *
 * Restores the database to "NAV connection just configured" state:
 *  - Clears NAV replica tables (nav_vendors, nav_brands, nav_seasons)
 *  - Deletes all brand/season/vendor except seed records
 *    (Brand ACME and Season PE00, required for the mandatory context edge case)
 *  - Clears dependent collection_layouts and pricing_parameter_sets
 *
 * Usage:
 *   pnpm --filter @luke/api db:nav-reset
 *
 * WARNING: destructive — development/test environments only.
 */

import { createScriptPrismaClient } from './lib/prisma.js';

const SEED_BRAND_CODE = 'ACME';
const SEED_SEASON_CODE = 'PE00';

async function main() {
  const isDev =
    process.env.NODE_ENV !== 'production' &&
    process.env.NODE_ENV !== 'prod';

  if (!isDev) {
    console.error('❌ nav-reset è abilitato solo in ambienti non-production.');
    process.exit(1);
  }

  const prisma = createScriptPrismaClient();

  try {
    console.log('🔄 NAV Reset — avvio pulizia dati...\n');

    // ── 1. Brand/season dependencies (no onDelete: Cascade) ──────────

    const [clCount, ppsCount] = await Promise.all([
      prisma.collectionLayout.count(),
      prisma.pricingParameterSet.count(),
    ]);

    const [delCL, delPPS] = await Promise.all([
      prisma.collectionLayout.deleteMany({}),
      prisma.pricingParameterSet.deleteMany({}),
    ]);

    console.log(`🗑  collection_layouts:       ${delCL.count} / ${clCount}`);
    console.log(`🗑  pricing_parameter_sets:   ${delPPS.count} / ${ppsCount}`);

    // ── 2. NAV replica tables ─────────────────────────────────────────────

    const [nvCount, nbCount, nsCount] = await Promise.all([
      prisma.navVendor.count(),
      prisma.navBrand.count(),
      prisma.navSeason.count(),
    ]);

    const [delNV, delNB, delNS] = await Promise.all([
      prisma.navVendor.deleteMany({}),
      prisma.navBrand.deleteMany({}),
      prisma.navSeason.deleteMany({}),
    ]);

    console.log(`🗑  nav_vendors:              ${delNV.count} / ${nvCount}`);
    console.log(`🗑  nav_brands:               ${delNB.count} / ${nbCount}`);
    console.log(`🗑  nav_seasons:              ${delNS.count} / ${nsCount}`);

    // ── 3. Local master records (preserve seed records) ─────────────────

    const [vendorCount, brandCount, seasonCount] = await Promise.all([
      prisma.vendor.count(),
      prisma.brand.count({ where: { code: { not: SEED_BRAND_CODE } } }),
      prisma.season.count({ where: { code: { not: SEED_SEASON_CODE } } }),
    ]);

    const [delV, delB, delS] = await Promise.all([
      prisma.vendor.deleteMany({}),
      prisma.brand.deleteMany({ where: { code: { not: SEED_BRAND_CODE } } }),
      prisma.season.deleteMany({ where: { code: { not: SEED_SEASON_CODE } } }),
    ]);

    console.log(`🗑  vendors:                  ${delV.count} / ${vendorCount}`);
    console.log(`🗑  brands (non-seed):        ${delB.count} / ${brandCount}`);
    console.log(`🗑  seasons (non-seed):       ${delS.count} / ${seasonCount}`);

    // ── 4. Final state summary ──────────────────────────────────────────

    const [remBrands, remSeasons, remVendors] = await Promise.all([
      prisma.brand.findMany({ select: { code: true, name: true } }),
      prisma.season.findMany({ select: { code: true, name: true } }),
      prisma.vendor.count(),
    ]);

    console.log('\n✅ Pulizia completata. Stato finale:');
    console.log(`   brands rimasti:  ${remBrands.map(b => b.code).join(', ')}`);
    console.log(`   seasons rimaste: ${remSeasons.map(s => s.code).join(', ')}`);
    console.log(`   vendors rimasti: ${remVendors}`);
    console.log('\n   Tutte le tabelle NAV replica sono vuote.');
    console.log('   Esegui il sync da Impostazioni › Microsoft NAV per ripopolarle.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
