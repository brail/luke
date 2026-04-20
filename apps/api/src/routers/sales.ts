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

import { getNavDbConfig, getPool, queryPortafoglioOrdini, sanitizeCompany } from '@luke/nav';
import {
  getUserAllowedBrandIds,
  getUserAllowedSeasonIds,
} from '../services/context.service';

import { getConfig } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import { buildPortafoglioXlsx } from '../services/sales.statistics';
import { buildKimoXlsx } from '../services/kimo.statistics';

import { queryPortafoglioFromPg } from '../services/portafoglio-pg-query';
import { queryKimoFromPg } from '../services/kimo-pg-query';
import {
  triggerPortafoglioSyncNow,
  isPortafoglioSyncRunning,
} from '../lib/portafoglioSyncScheduler';
import {
  triggerKimoSyncNow,
  isKimoSyncRunning,
} from '../lib/kimoSyncScheduler';

// ─── Input schema ─────────────────────────────────────────────────────────────

const portafoglioBaseInput = z.object({
  brandId: z.string().uuid('Brand ID non valido'),
  seasonId: z.string().uuid('Season ID non valido'),
});

const portafoglioDownloadInput = portafoglioBaseInput.extend({
  salespersonCode: z.string().min(1).optional(),
  customerCode: z.string().min(1).optional(),
});

// ─── Helper: valida che l'utente abbia accesso al brand/season ───────────────

async function assertContextAccess(
  userId: string,
  brandId: string,
  seasonId: string,
  prisma: Parameters<typeof getUserAllowedBrandIds>[1],
) {
  const allowedBrands = await getUserAllowedBrandIds(userId, prisma);
  if (allowedBrands !== null && !allowedBrands.includes(brandId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso al brand non consentito',
    });
  }

  const allowedSeasons = await getUserAllowedSeasonIds(userId, brandId, prisma);
  if (allowedSeasons !== null && !allowedSeasons.includes(seasonId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso alla stagione non consentita',
    });
  }
}

// ─── Sub-router: portafoglio ──────────────────────────────────────────────────

const portafoglioRouter = router({
  /**
   * Restituisce i filtri disponibili per il portafoglio.
   * Legge gli agenti da nav_pf_sales_header + nav_pf_salesperson (dati replicati in PG).
   * Fallback su NAV diretto se la replica non ha ancora dati per questa stagione.
   */
  getFilters: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioBaseInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await assertContextAccess(userId, input.brandId, input.seasonId, ctx.prisma);

      const [brand, season] = await Promise.all([
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true, name: true } }),
      ]);

      if (!brand || !season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione non trovati' });
      }

      // Prova prima con i dati replicati in PG
      const pgRows = await ctx.prisma.$queryRaw<{ code: string; name: string }[]>`
        SELECT DISTINCT sp.code, sp.name
        FROM nav_pf_sales_header sh
        JOIN nav_pf_salesperson sp ON sh."salespersonCode" = sp.code
        WHERE sh."sellingSeasonCode" = ${season.code}
          AND sh."shortcutDimension2Code" = ${brand.code}
          AND sh."salespersonCode" IS NOT NULL
        ORDER BY sp.name
      `;

      if (pgRows.length > 0) {
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

        const request = pool.request();
        (request as unknown as Record<string, unknown>)['timeout'] = 15_000;
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
   * Avvia un sync portafoglio NAV → PG immediatamente.
   * Usato dal bottone "Aggiorna Ora" nell'UI.
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
   * Restituisce lo stato di sync delle tabelle nav_pf_*.
   * Usato dalla UI per mostrare last-sync timestamp e progress.
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
   * Genera il file xlsx del portafoglio ordini per il brand/season corrente.
   * Restituisce il buffer codificato in base64 per il download lato client.
   */
  download: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioDownloadInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await assertContextAccess(userId, input.brandId, input.seasonId, ctx.prisma);

      // Leggi i codici NAV dal DB Postgres
      const [brand, season] = await Promise.all([
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true } }),
      ]);

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
   * Filtri disponibili per Vendite+Bidone Kimo.
   * Legge gli agenti distinti da nav_kimo_sales_header per il brand corrente.
   */
  getFilters: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioBaseInput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await assertContextAccess(userId, input.brandId, input.seasonId, ctx.prisma);

      const [brand, season] = await Promise.all([
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true, name: true } }),
      ]);

      if (!brand || !season) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione non trovati' });
      }

      // Agenti dalle SO (step0)
      const spSo = await ctx.prisma.$queryRaw<{ code: string; name: string }[]>`
        SELECT DISTINCT sp."code", sp."name"
        FROM nav_pf_sales_header sh
        JOIN nav_pf_salesperson sp ON sh."salespersonCode" = sp."code"
        WHERE sh."sellingSeasonCode" = ${season.code}
          AND sh."shortcutDimension2Code" = ${brand.code}
          AND sh."salespersonCode" IS NOT NULL
      `;

      // Agenti dai BASKET (step1)
      const spBa = await ctx.prisma.$queryRaw<{ code: string; name: string }[]>`
        SELECT DISTINCT sp."code", sp."name"
        FROM nav_kimo_sales_header kh
        JOIN nav_pf_salesperson sp ON kh."salespersonCodeNav" = sp."code"
        WHERE kh."trademarkCode" = ${brand.code}
          AND (kh."assignedSalesDocumentNo" IS NULL OR kh."assignedSalesDocumentNo" = '')
          AND kh."salespersonCodeNav" IS NOT NULL
      `;

      // Unione deduplicata
      const spMap = new Map<string, string>();
      for (const r of [...spSo, ...spBa]) spMap.set(r.code, r.name);
      const salespersons = [...spMap.entries()]
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        brand:  { code: brand.code, name: brand.name },
        season: { code: season.code, name: season.name },
        salespersons,
      };
    }),

  /**
   * Stato di sync delle tabelle nav_kimo_*.
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
   * Avvia un sync KIMO NAV → PG immediatamente.
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
   * Genera il file xlsx Vendite+Bidone Kimo per il brand/season corrente.
   * UNION di SO da nav_pf_* e BASKET da nav_kimo_*.
   */
  download: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(portafoglioDownloadInput)
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.user.id;
      await assertContextAccess(userId, input.brandId, input.seasonId, ctx.prisma);

      const [brand, season] = await Promise.all([
        ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true, name: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true } }),
      ]);

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
