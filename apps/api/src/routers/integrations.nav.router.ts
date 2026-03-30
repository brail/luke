/**
 * NAV sub-router per integrazioni
 * Gestisce configurazione, test connessione e sincronizzazione
 * Microsoft Dynamics NAV (SQL Server)
 */

import { z } from 'zod';

import { navConfigSchema } from '@luke/core';
import { getNavDbConfig, getPool, closePool, runNavSync, testNavConnection, sanitizeCompany } from '@luke/nav';
import { pauseNavScheduler, resumeNavScheduler } from '../lib/navSyncScheduler';

import { logAudit } from '../lib/auditLog';
import { saveConfig, getConfig } from '../lib/configManager';
import {
  ErrorCode,
  createStandardError,
  toTRPCError,
} from '../lib/errorHandler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

// ── Sync sub-router ───────────────────────────────────────────────────────────

const navSyncRouter = router({
  /**
   * Preview live: query diretta su NAV SQL Server (non sulla replica Postgres).
   * Restituisce i campi essenziali per la tabella di selezione.
   */
  preview: protectedProcedure
    .use(requirePermission('config:read'))
    .input(z.object({ entity: z.enum(['vendor', 'brand', 'season']) }))
    .query(async ({ input, ctx }) => {
      const config = await getNavDbConfig(ctx.prisma, getConfig);
      const pool = await getPool(config);

      if (input.entity === 'brand') {
        const tableName = `[${sanitizeCompany(config.company)}$Brand]`;
        let result;
        try {
          const req = pool.request();
          (req as any).timeout = 30_000;
          result = await req.query<{ 'Code': string; 'Description': string | null }>(`
            SELECT [Code], [Description]
            FROM ${tableName}
            ORDER BY [Code]
          `);
        } catch (e: any) {
          const err = createStandardError(ErrorCode.CONNECTION_ERROR, `Errore query NAV: ${e.message}`);
          throw toTRPCError(err);
        }
        return result.recordset.map(row => ({
          navNo: row['Code'],
          name: row['Description'] ?? '',
          city: null,
          countryCode: null,
          blocked: 0,
        }));
      }

      if (input.entity === 'season') {
        const tableName = `[${sanitizeCompany(config.company)}$Season]`;
        let result;
        try {
          const req = pool.request();
          (req as any).timeout = 30_000;
          result = await req.query<{
            'Code': string;
            'Description': string | null;
            'Starting Date': Date | null;
            'Ending Date': Date | null;
          }>(`
            SELECT [Code], [Description], [Starting Date], [Ending Date]
            FROM ${tableName}
            ORDER BY [Code]
          `);
        } catch (e: any) {
          const err = createStandardError(ErrorCode.CONNECTION_ERROR, `Errore query NAV: ${e.message}`);
          throw toTRPCError(err);
        }
        return result.recordset.map(row => ({
          navNo: row['Code'],
          name: row['Description'] ?? '',
          city: row['Starting Date']?.toISOString().slice(0, 10) ?? null,
          countryCode: row['Ending Date']?.toISOString().slice(0, 10) ?? null,
          blocked: 0,
        }));
      }

      // vendor (default)
      const tableName = `[${sanitizeCompany(config.company)}$Vendor]`;

      type NavVendorRow = {
        'No_': string;
        'Name': string;
        'City': string | null;
        'Country_Region Code': string | null;
        'Blocked': number;
      };

      let result;
      try {
        const req = pool.request();
        (req as any).timeout = 30_000;
        result = await req.query<NavVendorRow>(`
          SELECT [No_], [Name], [City], [Country_Region Code], [Blocked]
          FROM ${tableName}
          ORDER BY [Name]
        `);
      } catch (e: any) {
        const err = createStandardError(ErrorCode.CONNECTION_ERROR, `Errore query NAV: ${e.message}`);
        throw toTRPCError(err);
      }

      return result.recordset.map(row => ({
        navNo: row['No_'],
        name: row['Name'] ?? '',
        city: row['City'] ?? null,
        countryCode: row['Country_Region Code'] ?? null,
        blocked: row['Blocked'] ?? 0,
      }));
    }),

  /**
   * Restituisce lo stato di pianificazione auto-sync per tutte le entità.
   * Usato dalla UI per mostrare lo stato corrente per-entità.
   */
  getStatus: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      const filters = await ctx.prisma.navSyncFilter.findMany({
        select: { entity: true, autoSyncEnabled: true, intervalMinutes: true },
      });
      return Object.fromEntries(
        filters.map(f => [f.entity, { autoSyncEnabled: f.autoSyncEnabled, intervalMinutes: f.intervalMinutes }])
      ) as Record<string, { autoSyncEnabled: boolean; intervalMinutes: number }>;
    }),

  /**
   * Salva la configurazione di pianificazione auto-sync per un'entità.
   * Crea il filtro con mode='all' se non esiste ancora.
   */
  saveSyncSchedule: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({
      entity: z.enum(['vendor', 'brand', 'season', 'portafoglio']),
      autoSyncEnabled: z.boolean(),
      intervalMinutes: z.number().int().min(1).max(1440),
    }))
    .mutation(async ({ input, ctx }) => {
      const filter = await ctx.prisma.navSyncFilter.upsert({
        where: { entity: input.entity },
        create: {
          entity: input.entity,
          mode: 'all',
          navNos: [],
          autoSyncEnabled: input.autoSyncEnabled,
          intervalMinutes: input.intervalMinutes,
        },
        update: {
          autoSyncEnabled: input.autoSyncEnabled,
          intervalMinutes: input.intervalMinutes,
        },
      });

      await logAudit(ctx, {
        action: 'CONFIG_NAV_SYNC_SCHEDULE_UPDATE',
        targetType: 'NavSyncFilter',
        targetId: input.entity,
        result: 'SUCCESS',
        metadata: { entity: input.entity, autoSyncEnabled: input.autoSyncEnabled, intervalMinutes: input.intervalMinutes },
      });

      ctx.logger.info(
        { entity: input.entity, autoSyncEnabled: input.autoSyncEnabled, intervalMinutes: input.intervalMinutes },
        'NavSyncFilter pianificazione aggiornata'
      );

      return filter;
    }),

  /** Restituisce il NavSyncFilter corrente per l'entità. */
  getFilter: protectedProcedure
    .use(requirePermission('config:read'))
    .input(z.object({ entity: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.navSyncFilter.findUnique({
        where: { entity: input.entity },
      });
    }),

  /** Upsert del NavSyncFilter. */
  saveFilter: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({
      entity: z.string().min(1),
      mode: z.enum(['all', 'whitelist', 'exclude']),
      navNos: z.array(z.string()),
      active: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const navNos = input.mode === 'all' ? [] : [...new Set(input.navNos)];

      const filter = await ctx.prisma.navSyncFilter.upsert({
        where: { entity: input.entity },
        create: { entity: input.entity, mode: input.mode, navNos, active: input.active ?? true },
        update: { mode: input.mode, navNos, ...(input.active !== undefined && { active: input.active }) },
      });

      await logAudit(ctx, {
        action: 'CONFIG_NAV_FILTER_UPDATE',
        targetType: 'NavSyncFilter',
        targetId: input.entity,
        result: 'SUCCESS',
        metadata: { entity: input.entity, mode: input.mode, navNosCount: navNos.length },
      });

      ctx.logger.info(
        { entity: input.entity, mode: input.mode, navNosCount: navNos.length },
        'NavSyncFilter aggiornato'
      );

      return filter;
    }),

  /**
   * Esegue il sync manualmente on-demand per una singola entità.
   * Restituisce i risultati con durationMs.
   */
  run: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ entity: z.enum(['vendor', 'brand', 'season']) }))
    .mutation(async ({ input, ctx }) => {
      const report = await runNavSync(ctx.prisma, getConfig, undefined, input.entity);

      const durationMs = report.completedAt.getTime() - report.startedAt.getTime();

      await logAudit(ctx, {
        action: 'NAV_SYNC_RUN',
        targetType: 'NavSync',
        result: 'SUCCESS',
        metadata: {
          durationMs,
          results: report.results.map(r => ({
            entity: r.entity,
            upserted: r.upserted,
            skipped: r.skipped,
          })),
        },
      });

      return {
        results: report.results.map(r => ({
          entity: r.entity,
          upserted: r.upserted,
          skipped: r.skipped,
          filterMode: r.filterMode,
          durationMs,
        })),
      };
    }),
});

// ── Vendors sub-router ────────────────────────────────────────────────────────

const navVendorsRouter = router({
  /**
   * Lista vendor sincronizzati dal DB locale (non query live su NAV).
   * Usato dalla tendina di selezione fornitore nel Collection Layout.
   */
  list: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .query(async ({ ctx }) => {
      return ctx.prisma.navVendor.findMany({
        select: { navNo: true, name: true, searchName: true },
        orderBy: { searchName: 'asc' },
      });
    }),
});

// ── Brands sub-router ─────────────────────────────────────────────────────────

const navBrandsRouter = router({
  /**
   * Lista brand sincronizzati dal DB locale.
   * Esclude i navCode già collegati a un brand locale (navBrandId univoco).
   * excludeLinkedTo: navCode del brand corrente in modifica — resta visibile anche se già linkato.
   */
  list: protectedProcedure
    .use(requirePermission('brands:read'))
    .input(z.object({ excludeLinkedTo: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const linkedCodes = await ctx.prisma.brand.findMany({
        where: {
          navBrandId: { not: null },
          ...(input?.excludeLinkedTo ? { navBrandId: { not: input.excludeLinkedTo } } : {}),
        },
        select: { navBrandId: true },
      });
      const usedCodes = linkedCodes.map(b => b.navBrandId!);

      return ctx.prisma.navBrand.findMany({
        where: usedCodes.length > 0 ? { navCode: { notIn: usedCodes } } : undefined,
        select: { navCode: true, description: true },
        orderBy: { navCode: 'asc' },
      });
    }),
});

// ── Seasons sub-router ────────────────────────────────────────────────────────

const navSeasonsRouter = router({
  /**
   * Lista season sincronizzate dal DB locale.
   * Esclude i navCode già collegati a una season locale (navSeasonId univoco).
   * excludeLinkedTo: navCode della season corrente in modifica — resta visibile anche se già linkato.
   */
  list: protectedProcedure
    .use(requirePermission('seasons:read'))
    .input(z.object({ excludeLinkedTo: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const linkedCodes = await ctx.prisma.season.findMany({
        where: {
          navSeasonId: { not: null },
          ...(input?.excludeLinkedTo ? { navSeasonId: { not: input.excludeLinkedTo } } : {}),
        },
        select: { navSeasonId: true },
      });
      const usedCodes = linkedCodes.map(s => s.navSeasonId!);

      return ctx.prisma.navSeason.findMany({
        where: usedCodes.length > 0 ? { navCode: { notIn: usedCodes } } : undefined,
        select: { navCode: true, description: true, startingDate: true, endingDate: true },
        orderBy: { navCode: 'asc' },
      });
    }),
});

// ── Main router ───────────────────────────────────────────────────────────────

export const navRouter = router({
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(navConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Password aggiornata solo se il campo non è vuoto (form non tocca il campo → stringa vuota)
      const passwordUpdated = !!input.password && input.password.length > 0;

      // Legge i valori correnti per rilevare cambi di connessione
      const [prevHost, prevPort, prevDatabase, prevUser, prevCompany] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.nav.host', false),
        getConfig(ctx.prisma, 'integrations.nav.port', false),
        getConfig(ctx.prisma, 'integrations.nav.database', false),
        getConfig(ctx.prisma, 'integrations.nav.user', false),
        getConfig(ctx.prisma, 'integrations.nav.company', false),
      ]);

      const connectionChanged =
        prevHost !== input.host ||
        prevPort !== input.port.toString() ||
        prevDatabase !== input.database ||
        prevUser !== input.user ||
        prevCompany !== input.company ||
        passwordUpdated;

      // Se la connessione è cambiata, azzera il pool mssql (credenziali vecchie non più valide)
      if (connectionChanged) {
        await pauseNavScheduler();
        try {
          await closePool();
        } finally {
          resumeNavScheduler();
        }
      }

      await saveConfig(ctx.prisma, 'integrations.nav.host', input.host, false);
      await saveConfig(ctx.prisma, 'integrations.nav.port', input.port.toString(), false);
      await saveConfig(ctx.prisma, 'integrations.nav.database', input.database, false);
      await saveConfig(ctx.prisma, 'integrations.nav.user', input.user, false);
      await saveConfig(ctx.prisma, 'integrations.nav.company', input.company, false);
      await saveConfig(ctx.prisma, 'integrations.nav.readOnly', input.readOnly.toString(), false);
      await saveConfig(ctx.prisma, 'integrations.nav.syncEnabled', input.syncEnabled.toString(), false);

      if (passwordUpdated) {
        await saveConfig(ctx.prisma, 'integrations.nav.password', input.password!, true);
      }

      ctx.logger.info(
        { host: input.host, port: input.port, database: input.database, user: input.user, company: input.company, readOnly: input.readOnly, passwordUpdated, connectionChanged },
        'Configurazione NAV salvata'
      );

      await logAudit(ctx, {
        action: 'CONFIG_NAV_UPDATE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { host: input.host, port: input.port, database: input.database, user: input.user, company: input.company, readOnly: input.readOnly, passwordUpdated, connectionChanged },
      });

      return {
        success: true,
        message: 'Configurazione NAV salvata con successo',
        connectionChanged,
      };
    }),

  testConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .mutation(async ({ ctx }) => {
      // Legge tutta la config salvata (inclusa password decifrata)
      let config;
      try {
        config = await getNavDbConfig(ctx.prisma, getConfig);
      } catch {
        const err = createStandardError(
          ErrorCode.CONFIG_ERROR,
          'Configurazione NAV incompleta. Salva tutti i campi (host, porta, database, utente, password, company) prima di testare.'
        );
        throw toTRPCError(err);
      }

      const result = await testNavConnection(config);

      if (!result.success) {
        const failedStep = [...result.steps].reverse().find(s => !s.ok);
        const err = createStandardError(
          ErrorCode.CONNECTION_ERROR,
          failedStep?.message ?? 'Test connessione fallito'
        );
        throw toTRPCError(err);
      }

      return {
        success: true,
        message: `Connessione verificata: autenticazione, database e company OK.`,
        steps: result.steps,
      };
    }),

  sync: navSyncRouter,
  vendors: navVendorsRouter,
  brands: navBrandsRouter,
  seasons: navSeasonsRouter,
});
