/**
 * Router tRPC per la sezione Vendite
 *
 * Espone:
 *  - sales.statistics.portafoglio.getFilters  — filtri disponibili (agenti dal contesto)
 *  - sales.statistics.portafoglio.download    — genera xlsx portafoglio ordini
 *  - sales.statistics.kimo.getFilters         — filtri disponibili per Kimo+Bidone
 *  - sales.statistics.kimo.getSyncState       — stato sync tabelle nav_kimo_*
 *  - sales.statistics.kimo.triggerSync        — trigger manuale sync KIMO
 *  - sales.statistics.kimo.download           — genera xlsx Vendite+Bidone KIMO
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Role } from '@luke/core';
import { createSyncRequest, getNavDbConfig, getPool, queryPortafoglioOrdini, sanitizeCompany, queryPortafoglioFromPg, queryKimoFromPg } from '@luke/nav';

import { getConfig } from '../lib/configManager';
import {
  triggerKimoSyncNow,
  isKimoSyncRunning,
} from '../lib/kimoSyncScheduler';
import { requirePermission } from '../lib/permissions';
import {
  triggerPortafoglioSyncNow,
  isPortafoglioSyncRunning,
} from '../lib/portafoglioSyncScheduler';
import { router, protectedProcedure } from '../lib/trpc';
import { getUserAllowedBrandIds } from '../services/context.service';
import { buildKimoXlsx } from '../services/kimo.statistics';
import { buildPortafoglioXlsx } from '../services/sales.statistics';

import type { PrismaClient } from '@prisma/client';

// ─── Input schema ─────────────────────────────────────────────────────────────

const portafoglioBaseInput = z.object({
  brandId: z.string().uuid('Brand ID non valido'),
  seasonId: z.string().uuid('Season ID non valido'),
});

const portafoglioDownloadInput = portafoglioBaseInput.extend({
  salespersonCode: z.string().min(1).optional(),
  customerCode: z.string().min(1).optional(),
});

/**
 * Resolves salesperson names for a set of codes from the nav_pf_salesperson replica.
 * Returns a Map so callers can look up names for codes gathered from different sources.
 */
async function resolveSalespersonNames(
  prisma: PrismaClient,
  codes: string[],
): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = await prisma.navPfSalesperson.findMany({
    where: { code: { in: codes } },
    select: { code: true, name: true },
  });
  return new Map(rows.map(r => [r.code, r.name ?? '']));
}

// ─── Sub-router: portafoglio ──────────────────────────────────────────────────

const portafoglioRouter = router({
  /**
   * Returns available filter options (salespersons) for the order portfolio of a brand+season, reading from PG replica with NAV direct fallback.
   *
   * @auth {sales:read}
   * @input {{ brandId: string (UUID), seasonId: string (UUID) }}
   * @output {{ brand, season, salespersons: { code, name }[] }}
   */
  getFilters: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioBaseInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [allowedBrands, brand, season] = await Promise.all([
        getUserAllowedBrandIds(userId, ctx.prisma, ctx.session.user.role as Role),
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true, name: true } }),
      ]);
      if (allowedBrands !== null && !allowedBrands.includes(input.brandId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Accesso al brand non consentito' });
      }
      if (!brand || !season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione non trovati' });
      }

      // Prova prima con i dati replicati in PG
      const headerRows = await ctx.prisma.navPfSalesHeader.findMany({
        where: {
          sellingSeasonCode: season.code,
          shortcutDimension2Code: brand.code,
          salespersonCode: { not: null },
        },
        select: { salespersonCode: true },
        distinct: ['salespersonCode'],
      });
      const salespersonCodes = headerRows
        .map(r => r.salespersonCode)
        .filter((c): c is string => c !== null);

      if (salespersonCodes.length > 0) {
        const nameMap = await resolveSalespersonNames(ctx.prisma, salespersonCodes);
        const pgRows = salespersonCodes
          .map(code => ({ code, name: nameMap.get(code) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          brand: { code: brand.code, name: brand.name },
          season: { code: season.code, name: season.name },
          salespersons: pgRows,
        };
      }

      // Fallback: NAV diretto se la replica non ha ancora dati
      try {
        const navConfig = await getNavDbConfig(ctx.prisma, getConfig);
        const pool = await getPool(navConfig);
        const co = sanitizeCompany(navConfig.company);

        const request = createSyncRequest(pool, 15_000);
        request.input('SeasonCode', season.code);
        request.input('TrademarkCode', brand.code);

        const result = await request.query<{ Code: string; Name: string }>(`
          SELECT DISTINCT sp.Code, sp.Name
          FROM [${co}$Sales Header] sh
          LEFT JOIN [${co}$Salesperson_Purchaser] sp ON sh.[Salesperson Code] = sp.Code
          WHERE sh.[Selling Season Code] = @SeasonCode
            AND sh.[Shortcut Dimension 2 Code] = @TrademarkCode
            AND sp.Code IS NOT NULL
          ORDER BY sp.Name
        `);

        return {
          brand: { code: brand.code, name: brand.name },
          season: { code: season.code, name: season.name },
          salespersons: result.recordset.map(r => ({ code: r.Code, name: r.Name })),
        };
      } catch (err) {
        ctx.logger.warn({ err }, 'NAV getFilters fallback — NAV non raggiungibile');
        return {
          brand: { code: brand.code, name: brand.name },
          season: { code: season.code, name: season.name },
          salespersons: [],
        };
      }
    }),

  /**
   * Triggers an immediate NAV→PG portafoglio sync; returns conflict error if a sync is already running.
   *
   * @auth {sales:read}
   * @input {none}
   * @output {Sync result from triggerPortafoglioSyncNow()}
   */
  triggerSync: protectedProcedure
    .use(requirePermission('sales:read'))
    .mutation(async ({ ctx }) => {
      if (isPortafoglioSyncRunning()) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Sync già in corso — attendere il completamento',
        });
      }

      ctx.logger.info('sales.statistics.portafoglio.triggerSync: avvio manuale');
      const result = await triggerPortafoglioSyncNow();

      if (!result) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NAV non configurato o sync non disponibile',
        });
      }

      return result;
    }),

  /**
   * Returns the sync state (last sync timestamp, row count, duration) for all nav_pf_* replica tables.
   *
   * @auth {sales:read}
   * @input {none}
   * @output {{ isRunning: boolean, tables: { tableName, lastSyncedAt, rowCount, lastDurationMs }[] }}
   */
  getSyncState: protectedProcedure
    .use(requirePermission('sales:read'))
    .query(async ({ ctx }) => {
      const rows = await ctx.prisma.navPfSyncState.findMany({
        orderBy: { tableName: 'asc' },
      });

      return {
        isRunning: isPortafoglioSyncRunning(),
        tables: rows.map(r => ({
          tableName: r.tableName,
          lastSyncedAt: r.lastSyncedAt,
          rowCount: r.rowCount,
          lastDurationMs: r.lastDurationMs,
        })),
      };
    }),

  /**
   * Generates and returns the order portfolio XLSX for a brand+season (base64-encoded); uses PG replica with NAV direct fallback.
   *
   * @auth {sales:read}
   * @input {{ brandId, seasonId, salespersonCode?, customerCode? }}
   * @output {{ data: string (base64), filename: string, rowCount: number, queryDurationMs: number }}
   */
  download: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioDownloadInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [allowedBrands, brand, season] = await Promise.all([
        getUserAllowedBrandIds(userId, ctx.prisma, ctx.session.user.role as Role),
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true } }),
      ]);
      if (allowedBrands !== null && !allowedBrands.includes(input.brandId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Accesso al brand non consentito' });
      }
      if (!brand || !season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione non trovati' });
      }

      ctx.logger.info(
        {
          brandCode: brand.code,
          seasonCode: season.code,
          salespersonCode: input.salespersonCode,
          customerCode: input.customerCode,
        },
        'sales.statistics.portafoglio.download start',
      );

      // Controlla se i dati PG sono disponibili per questa stagione/brand
      const pgCount = await ctx.prisma.navPfSalesHeader.count({
        where: {
          sellingSeasonCode: season.code,
          shortcutDimension2Code: brand.code,
        },
      });
      const pgHasData = pgCount > 0;

      const queryStart = Date.now();
      let rows: Awaited<ReturnType<typeof queryPortafoglioFromPg>>;
      let dataSource: 'pg' | 'nav';

      if (pgHasData) {
        // Query su dati replicati in PostgreSQL (veloce, indici ottimizzati)
        dataSource = 'pg';
        rows = await queryPortafoglioFromPg(ctx.prisma, {
          seasonCode: season.code,
          trademarkCode: brand.code,
          salespersonCode: input.salespersonCode,
          customerCode: input.customerCode,
        });
      } else {
        // Fallback: query diretta NAV (lenta, nessuna replica disponibile)
        ctx.logger.warn(
          { brandCode: brand.code, seasonCode: season.code },
          'Portafoglio PG replica vuota — fallback NAV diretto',
        );
        dataSource = 'nav';
        const navConfig = await getNavDbConfig(ctx.prisma, getConfig);
        const pool = await getPool(navConfig);
        rows = await queryPortafoglioOrdini(pool, navConfig.company, {
          seasonCode: season.code,
          trademarkCode: brand.code,
          salespersonCode: input.salespersonCode,
          customerCode: input.customerCode,
        });
      }

      const queryDurationMs = Date.now() - queryStart;
      ctx.logger.info({ dataSource, rowCount: rows.length, queryDurationMs }, 'portafoglio download query done');

      // Build xlsx
      const sheetName = `${season.code}_${brand.code}`;
      const dbUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { firstName: true, lastName: true, email: true },
      });
      const authorName = [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(' ') || dbUser?.email || ctx.session.user.email;
      const buffer = await buildPortafoglioXlsx(rows, sheetName, {
        title: 'Analisi Vendite',
        subject: `${brand.name} - ${season.code}`,
        author: authorName,
        manager: `Luke - v${process.env.npm_package_version ?? 'unknown'}`,
      });
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}`;
      const filterSuffix = input.customerCode
        ? `_${input.customerCode}`
        : input.salespersonCode
          ? `_${input.salespersonCode}`
          : '';
      const filename = `Luke-AnalisiVendite-${datePart}-${timePart}-(${season.code}_${brand.code}${filterSuffix}).xlsx`;

      return {
        data: buffer.toString('base64'),
        filename,
        rowCount: rows.length,
        queryDurationMs,
      };
    }),
});

// ─── Sub-router: kimo ─────────────────────────────────────────────────────────

const kimoRouter = router({
  /**
   * Returns available filter options (salespersons) for the Kimo sales+basket report, merging agents from nav_pf_* and nav_kimo_*.
   *
   * @auth {sales:read}
   * @input {{ brandId: string (UUID), seasonId: string (UUID) }}
   * @output {{ brand, season, salespersons: { code, name }[] }}
   */
  getFilters: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioBaseInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [allowedBrands, brand, season] = await Promise.all([
        getUserAllowedBrandIds(userId, ctx.prisma, ctx.session.user.role as Role),
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true, name: true } }),
      ]);
      if (allowedBrands !== null && !allowedBrands.includes(input.brandId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Accesso al brand non consentito' });
      }
      if (!brand || !season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione non trovati' });
      }

      // Agenti dalle SO (step0) e dai BASKET (step1) — query indipendenti, in parallelo
      const [soHeaderRows, basketHeaderRows] = await Promise.all([
        ctx.prisma.navPfSalesHeader.findMany({
          where: {
            sellingSeasonCode: season.code,
            shortcutDimension2Code: brand.code,
            salespersonCode: { not: null },
          },
          select: { salespersonCode: true },
          distinct: ['salespersonCode'],
        }),
        ctx.prisma.navKimoSalesHeader.findMany({
          where: {
            trademarkCode: brand.code,
            salespersonCodeNav: { not: null },
            OR: [{ assignedSalesDocumentNo: null }, { assignedSalesDocumentNo: '' }],
          },
          select: { salespersonCodeNav: true },
          distinct: ['salespersonCodeNav'],
        }),
      ]);
      const spSoCodes = soHeaderRows
        .map(r => r.salespersonCode)
        .filter((c): c is string => c !== null);
      const spBaCodes = basketHeaderRows
        .map(r => r.salespersonCodeNav)
        .filter((c): c is string => c !== null);

      // Unione deduplicata
      const allCodes = [...new Set([...spSoCodes, ...spBaCodes])];
      const nameMap = await resolveSalespersonNames(ctx.prisma, allCodes);
      const salespersons = allCodes
        .map(code => ({ code, name: nameMap.get(code) ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        brand:  { code: brand.code, name: brand.name },
        season: { code: season.code, name: season.name },
        salespersons,
      };
    }),

  /**
   * Returns the sync state for all nav_kimo_* replica tables.
   *
   * @auth {sales:read}
   * @input {none}
   * @output {{ isRunning: boolean, tables: { tableName, lastSyncedAt, rowCount, lastDurationMs }[] }}
   */
  getSyncState: protectedProcedure
    .use(requirePermission('sales:read'))
    .query(async ({ ctx }) => {
      const rows = await ctx.prisma.navPfSyncState.findMany({
        where: { tableName: { startsWith: 'nav_kimo_' } },
        orderBy: { tableName: 'asc' },
      });

      return {
        isRunning: isKimoSyncRunning(),
        tables: rows.map(r => ({
          tableName:     r.tableName,
          lastSyncedAt:  r.lastSyncedAt,
          rowCount:      r.rowCount,
          lastDurationMs: r.lastDurationMs,
        })),
      };
    }),

  /**
   * Triggers an immediate NAV→PG KIMO sync; returns conflict error if already running.
   *
   * @auth {sales:read}
   * @input {none}
   * @output {Sync result from triggerKimoSyncNow()}
   */
  triggerSync: protectedProcedure
    .use(requirePermission('sales:read'))
    .mutation(async ({ ctx }) => {
      if (isKimoSyncRunning()) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Sync KIMO già in corso — attendere il completamento',
        });
      }

      ctx.logger.info('sales.statistics.kimo.triggerSync: avvio manuale');
      const result = await triggerKimoSyncNow();

      if (!result) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NAV non configurato o sync non disponibile',
        });
      }

      return result;
    }),

  /**
   * Generates and returns the Kimo sales+basket XLSX (UNION of nav_pf_* orders and nav_kimo_* baskets) for a brand+season.
   *
   * @auth {sales:read}
   * @input {{ brandId, seasonId, salespersonCode?, customerCode? }}
   * @output {{ data: string (base64), filename: string, rowCount: number, queryDurationMs: number }}
   */
  download: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioDownloadInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      const [allowedBrands, brand, season] = await Promise.all([
        getUserAllowedBrandIds(userId, ctx.prisma, ctx.session.user.role as Role),
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true } }),
      ]);
      if (allowedBrands !== null && !allowedBrands.includes(input.brandId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Accesso al brand non consentito' });
      }
      if (!brand || !season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione non trovati' });
      }

      ctx.logger.info(
        {
          brandCode: brand.code,
          seasonCode: season.code,
          salespersonCode: input.salespersonCode,
          customerCode: input.customerCode,
        },
        'sales.statistics.kimo.download start',
      );

      const queryStart = Date.now();
      const rows = await queryKimoFromPg(ctx.prisma, {
        seasonCode:     season.code,
        trademarkCode:  brand.code,
        salespersonCode: input.salespersonCode,
        customerCode:   input.customerCode,
      });
      const queryDurationMs = Date.now() - queryStart;

      ctx.logger.info({ rowCount: rows.length, queryDurationMs }, 'kimo download query done');

      const sheetName = `${season.code}_${brand.code}_Kimo`;
      const dbUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { firstName: true, lastName: true, email: true },
      });
      const authorName =
        [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(' ') ||
        dbUser?.email ||
        ctx.session.user.email;

      const buffer = await buildKimoXlsx(rows, sheetName, {
        title:   'Vendite + Bidone Kimo',
        subject: `${brand.name} - ${season.code}`,
        author:  authorName,
        manager: `Luke - v${process.env.npm_package_version ?? 'unknown'}`,
      });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}`;
      const filterSuffix = input.customerCode
        ? `_${input.customerCode}`
        : input.salespersonCode
          ? `_${input.salespersonCode}`
          : '';
      const filename = `Luke-KimoBidone-${datePart}-${timePart}-(${season.code}_${brand.code}${filterSuffix}).xlsx`;

      return {
        data: buffer.toString('base64'),
        filename,
        rowCount: rows.length,
        queryDurationMs,
      };
    }),
});

// ─── Router principale vendite ────────────────────────────────────────────────

export const salesRouter = router({
  statistics: router({
    portafoglio: portafoglioRouter,
    kimo: kimoRouter,
  }),
});
