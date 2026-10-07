/**
 * NAV sub-router for integrations
 * Handles configuration, connection testing, and synchronization
 * for Microsoft Dynamics NAV (SQL Server)
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { navConfigSchema } from '@luke/core';
import { createSyncRequest, getNavDbConfig, getPool, closePool, runNavSync, testNavConnection, sanitizeCompany } from '@luke/nav';


import { logAudit } from '../lib/auditLog';
import { getConfig, saveConfigs } from '../lib/configManager';
import { toErrorMessage } from '../lib/error';
import {
  ErrorCode,
  createStandardError,
  toTRPCError,
} from '../lib/errorHandler';
import { navConfigChanges, pauseNavScheduler, resumeNavScheduler } from '../lib/navSyncScheduler';
import { requirePermission } from '../lib/permissions';
import { enforceRateLimit } from '../lib/ratelimit';
import { resolveRateLimitPolicy } from '../lib/rateLimitPolicy';
import { withSchedulerLock } from '../lib/schedulerLock';
import { router, protectedProcedure } from '../lib/trpc';

// ── Sync sub-router ───────────────────────────────────────────────────────────

const navSyncRouter = router({
  /**
   * Queries NAV SQL Server directly (not the PG replica) for a live preview of vendor/brand/season records.
   *
   * @auth {config:read}
   * @input {{ entity: "vendor" | "brand" | "season" }}
   * @output {Array<{ navNo, name, city, countryCode, blocked }>}
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
          const req = createSyncRequest(pool);
          result = await req.query<{ 'Code': string; 'Description': string | null }>(`
            SELECT [Code], [Description]
            FROM ${tableName}
            ORDER BY [Code]
          `);
        } catch (e: unknown) {
          const err = createStandardError(ErrorCode.CONNECTION_ERROR, `Errore query NAV: ${toErrorMessage(e)}`);
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
          const req = createSyncRequest(pool);
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
        } catch (e: unknown) {
          const err = createStandardError(ErrorCode.CONNECTION_ERROR, `Errore query NAV: ${toErrorMessage(e)}`);
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
        const req = createSyncRequest(pool);
        result = await req.query<NavVendorRow>(`
          SELECT [No_], [Name], [City], [Country_Region Code], [Blocked]
          FROM ${tableName}
          ORDER BY [Name]
        `);
      } catch (e: unknown) {
        const err = createStandardError(ErrorCode.CONNECTION_ERROR, `Errore query NAV: ${toErrorMessage(e)}`);
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
   * Returns the auto-sync schedule status (enabled, intervalMinutes) and the outcome
   * of the most recent scheduled sync attempt for all NAV sync entities.
   *
   * @auth {config:read}
   * @input {none}
   * @output {Record<string, { autoSyncEnabled: boolean, intervalMinutes: number, lastSyncStatus: string | null, lastSyncError: string | null, lastSyncAt: Date | null }>}
   */
  getStatus: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      const filters = await ctx.prisma.navSyncFilter.findMany({
        select: {
          entity: true,
          autoSyncEnabled: true,
          intervalMinutes: true,
          lastSyncStatus: true,
          lastSyncError: true,
          lastSyncAt: true,
        },
      });
      return Object.fromEntries(
        filters.map(f => [
          f.entity,
          {
            autoSyncEnabled: f.autoSyncEnabled,
            intervalMinutes: f.intervalMinutes,
            lastSyncStatus: f.lastSyncStatus,
            lastSyncError: f.lastSyncError,
            lastSyncAt: f.lastSyncAt,
          },
        ])
      ) as Record<
        string,
        {
          autoSyncEnabled: boolean;
          intervalMinutes: number;
          lastSyncStatus: string | null;
          lastSyncError: string | null;
          lastSyncAt: Date | null;
        }
      >;
    }),

  /**
   * Saves the auto-sync schedule for a NAV entity; creates the filter with mode='all' if absent.
   *
   * @auth {config:update}
   * @input {{ entity, autoSyncEnabled: boolean, intervalMinutes: number }}
   * @output {NavSyncFilter}
   */
  saveSyncSchedule: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({
      entity: z.enum(['vendor', 'brand', 'season', 'portafoglio', 'kimo']),
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
        'NavSyncFilter schedule updated'
      );

      return filter;
    }),

  /**
   * Returns the current NavSyncFilter for the given entity.
   *
   * @auth {config:read}
   * @input {{ entity: string }}
   * @output {NavSyncFilter | null}
   */
  getFilter: protectedProcedure
    .use(requirePermission('config:read'))
    .input(z.object({ entity: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.navSyncFilter.findUnique({
        where: { entity: input.entity },
      });
    }),

  /**
   * Upserts the NavSyncFilter for an entity (mode, navNos whitelist/exclude, active flag).
   *
   * @auth {config:update}
   * @input {{ entity, mode: "all"|"whitelist"|"exclude", navNos: string[], active? }}
   * @output {NavSyncFilter}
   */
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
        'NavSyncFilter updated'
      );

      return filter;
    }),

  /**
   * Triggers an on-demand NAV sync for a single entity; returns per-entity results with durationMs.
   *
   * @auth {config:update}
   * @input {{ entity: "vendor" | "brand" | "season" }}
   * @output {{ results: Array<{ entity, upserted, skipped, filterMode, durationMs }> }}
   */
  run: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ entity: z.enum(['vendor', 'brand', 'season']) }))
    .mutation(async ({ input, ctx }) => {
      // One manual sync per entity per window, not one for all three: syncing vendors must not
      // block brands. Keyed by user and entity here, where the entity is known, whatever `keyBy`
      // the policy carries (the AppConfig override has no writer). The scheduler lock below keeps
      // two syncs of one entity apart, so at most one per entity runs at a time.
      const policy = await resolveRateLimitPolicy('navSyncTrigger', ctx.prisma);
      enforceRateLimit('navSyncTrigger', `${ctx.session.user.id}:${input.entity}`, policy);

      // The same lock as the scheduled sync of this entity, so the two never overlap.
      const report = await withSchedulerLock(ctx.prisma, `nav-sync:${input.entity}`, () =>
        runNavSync(ctx.prisma, getConfig, undefined, input.entity),
      )();
      if (!report) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Sincronizzazione già in corso per questa entità, riprova tra poco',
        });
      }

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
   * Lists vendors synced from NAV in the local PG replica (not a live NAV query).
   *
   * @auth {vendors:read}
   * @input {none}
   * @output {Array<{ navNo, name, searchName }>} — sorted by searchName ascending.
   */
  list: protectedProcedure
    .use(requirePermission('vendors:read'))
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
   * Lists NAV brands from the local replica, excluding codes already linked to a local brand (except excludeLinkedTo).
   *
   * @auth {brands:read}
   * @input {{ excludeLinkedTo?: string }} — navCode of the brand currently being edited.
   * @output {Array<{ navCode, description }>}
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
      const usedCodes = linkedCodes
        .filter((b): b is typeof b & { navBrandId: string } => b.navBrandId != null)
        .map(b => b.navBrandId);

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
   * Lists NAV seasons from the local replica, excluding codes already linked to a local season (except excludeLinkedTo).
   *
   * @auth {seasons:read}
   * @input {{ excludeLinkedTo?: string }} — navCode of the season currently being edited.
   * @output {Array<{ navCode, description, startingDate, endingDate }>}
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
      const usedCodes = linkedCodes
        .filter((s): s is typeof s & { navSeasonId: string } => s.navSeasonId != null)
        .map(s => s.navSeasonId);

      return ctx.prisma.navSeason.findMany({
        where: usedCodes.length > 0 ? { navCode: { notIn: usedCodes } } : undefined,
        select: { navCode: true, description: true, startingDate: true, endingDate: true },
        orderBy: { navCode: 'asc' },
      });
    }),
});

// ── Main router ───────────────────────────────────────────────────────────────

export const navRouter = router({
  /**
   * Saves the NAV SQL Server connection config to AppConfig; resets the mssql pool if credentials changed.
   *
   * @auth {config:update}
   * @input {navConfigSchema} — host, port, database, user, password (optional), company, readOnly, syncEnabled.
   * @output {{ success: true, message: string, connectionChanged: boolean }}
   */
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(navConfigSchema)
    .mutation(({ input, ctx }) =>
      // The whole change, from reading the previous values to the resume, runs alone: two
      // overlapping saves would otherwise strand a pause or resume the scheduler under each other.
      navConfigChanges.run(async () => {
        // Password updated only if the field isn't empty (form doesn't touch the field → empty string)
        const passwordUpdated = !!input.password && input.password.length > 0;

        // Reads the current values to detect connection changes
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

        // A changed connection pauses the scheduler before the write and closes the pool only once
        // the new settings are committed: closing it first let a tick in between reopen it with the
        // old credentials. A failed save leaves the pool as it was.
        if (connectionChanged) await pauseNavScheduler();
        try {
          await saveConfigs(ctx.prisma, [
            { key: 'integrations.nav.host', value: input.host },
            { key: 'integrations.nav.port', value: input.port.toString() },
            { key: 'integrations.nav.database', value: input.database },
            { key: 'integrations.nav.user', value: input.user },
            { key: 'integrations.nav.company', value: input.company },
            { key: 'integrations.nav.readOnly', value: input.readOnly.toString() },
            { key: 'integrations.nav.syncEnabled', value: input.syncEnabled.toString() },
            ...(passwordUpdated
              ? [{ key: 'integrations.nav.password' as const, value: input.password!, encrypt: true }]
              : []),
          ]);
          if (connectionChanged) {
            try {
              await closePool();
            } catch (err) {
              // The settings are committed; only the old connection survives, until the next
              // successful save or a restart closes it.
              ctx.logger.error({ err }, 'NAV pool close failed after the configuration was saved');
            }
          }
        } finally {
          if (connectionChanged) resumeNavScheduler();
        }

        ctx.logger.info(
          { host: input.host, port: input.port, database: input.database, user: input.user, company: input.company, readOnly: input.readOnly, passwordUpdated, connectionChanged },
          'NAV configuration saved'
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
      })
    ),

  /**
   * Tests the NAV SQL Server connection using the stored credentials.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ success: true, message: string, steps: Step[] }}
   */
  testConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .mutation(async ({ ctx }) => {
      // Reads the entire saved config (including decrypted password)
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
