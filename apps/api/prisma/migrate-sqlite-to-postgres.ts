/**
 * One-shot migration: SQLite dev.db → PostgreSQL
 *
 * Usage (from apps/api directory):
 *   npx ts-node --project tsconfig.json prisma/migrate-sqlite-to-postgres.ts
 *
 * Prerequisites:
 *   docker-compose -f docker-compose.dev.yml up -d
 *   pnpm --filter @luke/api exec prisma migrate deploy
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const SQLITE = path.resolve(__dirname, 'dev.db');
const prisma = new PrismaClient();

// ── helpers ──────────────────────────────────────────────────────────────────

function q(table: string): Record<string, unknown>[] {
  try {
    const out = execSync(`sqlite3 -json "${SQLITE}" "SELECT * FROM \\"${table}\\";"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim() ? (JSON.parse(out) as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

/** Unix milliseconds → Date (SQLite stores timestamps as INTEGER ms) */
const d = (v: unknown): Date | null => (v == null ? null : new Date(v as number));
const d_ = (v: unknown): Date => d(v)!;

/** SQLite BOOLEAN is stored as 0/1 INTEGER */
const b = (v: unknown): boolean => v === 1 || v === true;

/** JSON field stored as TEXT string */
const j = (v: unknown) => (v == null ? undefined : JSON.parse(v as string));

// ── migration ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('SQLite → PostgreSQL migration\n');

  // 1. users
  const users = q('users');
  console.log(`users:                  ${users.length}`);
  for (const r of users) {
    await prisma.user.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:              r.id as string,
        email:           r.email as string,
        username:        r.username as string,
        firstName:       (r.firstName as string) ?? '',
        lastName:        (r.lastName as string) ?? '',
        role:            r.role as any,
        isActive:        b(r.isActive),
        pendingApproval: b(r.pendingApproval),
        locale:          (r.locale as string) ?? 'it-IT',
        timezone:        (r.timezone as string) ?? 'Europe/Rome',
        tokenVersion:    (r.tokenVersion as number) ?? 0,
        loginCount:      (r.loginCount as number) ?? 0,
        emailVerifiedAt: d(r.emailVerifiedAt),
        lastLoginAt:     d(r.lastLoginAt),
        createdAt:       d_(r.createdAt),
        updatedAt:       d_(r.updatedAt),
      },
    });
  }

  // 2. identities
  const identities = q('identities');
  console.log(`identities:             ${identities.length}`);
  for (const r of identities) {
    await prisma.identity.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:         r.id as string,
        userId:     r.userId as string,
        provider:   r.provider as any,
        providerId: r.providerId as string,
        metadata:   j(r.metadata),
        createdAt:  d_(r.createdAt),
        updatedAt:  d_(r.updatedAt),
      },
    });
  }

  // 3. local_credentials
  const creds = q('local_credentials');
  console.log(`local_credentials:      ${creds.length}`);
  for (const r of creds) {
    await prisma.localCredential.upsert({
      where: { identityId: r.identityId as string },
      update: {},
      create: {
        id:           r.id as string,
        identityId:   r.identityId as string,
        passwordHash: r.passwordHash as string,
        createdAt:    d_(r.createdAt),
        updatedAt:    d_(r.updatedAt),
      },
    });
  }

  // 4. user_tokens
  const tokens = q('user_tokens');
  console.log(`user_tokens:            ${tokens.length}`);
  for (const r of tokens) {
    await prisma.userToken.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:        r.id as string,
        userId:    r.userId as string,
        type:      r.type as any,
        tokenHash: r.tokenHash as string,
        expiresAt: d_(r.expiresAt),
        createdAt: d_(r.createdAt),
      },
    });
  }

  // 5. user_preferences
  const prefs = q('user_preferences');
  console.log(`user_preferences:       ${prefs.length}`);
  for (const r of prefs) {
    await prisma.userPreference.upsert({
      where: { userId: r.userId as string },
      update: {},
      create: {
        userId:          r.userId as string,
        lastBrandId:     (r.lastBrandId as string) ?? null,
        lastSeasonId:    (r.lastSeasonId as string) ?? null,
        pinnedContexts:  j(r.pinnedContexts),
        createdAt:       d_(r.createdAt),
        updatedAt:       d_(r.updatedAt),
      },
    });
  }

  // 6. user_section_access
  const sectionAccess = q('user_section_access');
  console.log(`user_section_access:    ${sectionAccess.length}`);
  for (const r of sectionAccess) {
    await prisma.userSectionAccess.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:        r.id as string,
        userId:    r.userId as string,
        section:   r.section as string,
        enabled:   b(r.enabled),
        createdAt: d_(r.createdAt),
        updatedAt: d_(r.updatedAt),
      },
    });
  }

  // 7. brands
  const brands = q('brands');
  console.log(`brands:                 ${brands.length}`);
  for (const r of brands) {
    await prisma.brand.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:        r.id as string,
        code:      r.code as string,
        name:      r.name as string,
        logoUrl:   (r.logoUrl as string) ?? null,
        isActive:  b(r.isActive),
        createdAt: d_(r.createdAt),
        updatedAt: d_(r.updatedAt),
      },
    });
  }

  // 8. seasons
  const seasons = q('seasons');
  console.log(`seasons:                ${seasons.length}`);
  for (const r of seasons) {
    await prisma.season.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:        r.id as string,
        code:      r.code as string,
        year:      r.year as number,
        name:      r.name as string,
        isActive:  b(r.isActive),
        createdAt: d_(r.createdAt),
        updatedAt: d_(r.updatedAt),
      },
    });
  }

  // 9. user_brand_access
  const brandAccess = q('user_brand_access');
  console.log(`user_brand_access:      ${brandAccess.length}`);
  for (const r of brandAccess) {
    await prisma.userBrandAccess.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:      r.id as string,
        userId:  r.userId as string,
        brandId: r.brandId as string,
      },
    });
  }

  // 10. user_season_access
  const seasonAccess = q('user_season_access');
  console.log(`user_season_access:     ${seasonAccess.length}`);
  for (const r of seasonAccess) {
    await prisma.userSeasonAccess.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:       r.id as string,
        userId:   r.userId as string,
        brandId:  r.brandId as string,
        seasonId: r.seasonId as string,
      },
    });
  }

  // 11. app_configs (preserve encrypted ciphertext as-is — same master key)
  const configs = q('app_configs');
  console.log(`app_configs:            ${configs.length}`);
  for (const r of configs) {
    await prisma.appConfig.upsert({
      where: { key: r.key as string },
      update: {},
      create: {
        id:          r.id as string,
        key:         r.key as string,
        value:       r.value as string,
        isEncrypted: b(r.isEncrypted),
        createdAt:   d_(r.createdAt),
        updatedAt:   d_(r.updatedAt),
      },
    });
  }

  // 12. pricing_parameter_sets
  const pricingSets = q('pricing_parameter_sets');
  console.log(`pricing_parameter_sets: ${pricingSets.length}`);
  for (const r of pricingSets) {
    await prisma.pricingParameterSet.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:                     r.id as string,
        brandId:                r.brandId as string,
        seasonId:               r.seasonId as string,
        name:                   r.name as string,
        purchaseCurrency:       (r.purchaseCurrency as string) ?? 'USD',
        sellingCurrency:        (r.sellingCurrency as string) ?? 'EUR',
        qualityControlPercent:  r.qualityControlPercent as number,
        transportInsuranceCost: r.transportInsuranceCost as number,
        duty:                   r.duty as number,
        exchangeRate:           r.exchangeRate as number,
        italyAccessoryCosts:    r.italyAccessoryCosts as number,
        tools:                  r.tools as number,
        retailMultiplier:       r.retailMultiplier as number,
        optimalMargin:          r.optimalMargin as number,
        isDefault:              b(r.isDefault),
        orderIndex:             (r.orderIndex as number) ?? 0,
        createdAt:              d_(r.createdAt),
        updatedAt:              d_(r.updatedAt),
      },
    });
  }

  // 13. collection_layouts
  const layouts = q('collection_layouts');
  console.log(`collection_layouts:     ${layouts.length}`);
  for (const r of layouts) {
    await prisma.collectionLayout.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:            r.id as string,
        brandId:       r.brandId as string,
        seasonId:      r.seasonId as string,
        skuBudget:     (r.skuBudget as number) ?? null,
        hiddenColumns: j(r.hiddenColumns),
        createdAt:     d_(r.createdAt),
        updatedAt:     d_(r.updatedAt),
      },
    });
  }

  // 14. collection_groups
  const groups = q('collection_groups');
  console.log(`collection_groups:      ${groups.length}`);
  for (const r of groups) {
    await prisma.collectionGroup.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:                  r.id as string,
        collectionLayoutId:  r.collectionLayoutId as string,
        name:                r.name as string,
        order:               (r.order as number) ?? 0,
        skuBudget:           (r.skuBudget as number) ?? null,
        createdAt:           d_(r.createdAt),
        updatedAt:           d_(r.updatedAt),
      },
    });
  }

  // 15. collection_layout_rows
  const rows = q('collection_layout_rows');
  console.log(`collection_layout_rows: ${rows.length}`);
  for (const r of rows) {
    await prisma.collectionLayoutRow.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:                    r.id as string,
        collectionLayoutId:    r.collectionLayoutId as string,
        groupId:               r.groupId as string,
        order:                 (r.order as number) ?? 0,
        gender:                r.gender as string,
        supplier:              r.supplier as string,
        line:                  r.line as string,
        status:                r.status as string,
        skuForecast:           r.skuForecast as number,
        qtyForecast:           r.qtyForecast as number,
        productCategory:       r.productCategory as string,
        strategy:              (r.strategy as string) ?? null,
        styleStatus:           (r.styleStatus as string) ?? null,
        progress:              (r.progress as string) ?? null,
        designer:              (r.designer as string) ?? null,
        pictureUrl:            (r.pictureUrl as string) ?? null,
        styleNotes:            (r.styleNotes as string) ?? null,
        materialNotes:         (r.materialNotes as string) ?? null,
        colorNotes:            (r.colorNotes as string) ?? null,
        priceNotes:            (r.priceNotes as string) ?? null,
        toolingNotes:          (r.toolingNotes as string) ?? null,
        pricingParameterSetId: (r.pricingParameterSetId as string) ?? null,
        retailTargetPrice:     (r.retailTargetPrice as number) ?? null,
        buyingTargetPrice:     (r.buyingTargetPrice as number) ?? null,
        supplierFirstQuotation:(r.supplierFirstQuotation as number) ?? null,
        toolingQuotation:      (r.toolingQuotation as number) ?? null,
        createdAt:             d_(r.createdAt),
        updatedAt:             d_(r.updatedAt),
      },
    });
  }

  // 16. file_objects
  const files = q('file_objects');
  console.log(`file_objects:           ${files.length}`);
  for (const r of files) {
    await prisma.fileObject.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:              r.id as string,
        bucket:          r.bucket as string,
        key:             r.key as string,
        originalName:    r.originalName as string,
        size:            r.size as number,
        contentType:     (r.contentType as string) ?? 'application/octet-stream',
        checksumSha256:  (r.checksumSha256 as string) ?? '',
        createdBy:       (r.createdBy as string) ?? '',
        cleanupStatus:   (r.cleanupStatus as string) ?? 'PENDING',
        cleanupAttempts: (r.cleanupAttempts as number) ?? 0,
        lastCleanupAt:   d(r.lastCleanupAt),
        createdAt:       d_(r.createdAt),
      },
    });
  }

  // 17. audit_logs
  const audits = q('audit_logs');
  console.log(`audit_logs:             ${audits.length}`);
  for (const r of audits) {
    await prisma.auditLog.upsert({
      where: { id: r.id as string },
      update: {},
      create: {
        id:         r.id as string,
        actorId:    (r.actorId as string) ?? null,
        action:     r.action as string,
        targetType: r.targetType as string,
        targetId:   (r.targetId as string) ?? null,
        result:     r.result as string,
        metadata:   j(r.metadata),
        traceId:    (r.traceId as string) ?? null,
        ip:         (r.ip as string) ?? null,
        createdAt:  d_(r.createdAt),
      },
    });
  }

  console.log('\n✓ Migration complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
