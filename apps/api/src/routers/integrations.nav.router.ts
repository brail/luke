/**
 * NAV sub-router per integrazioni
 * Gestisce configurazione, test connessione e sincronizzazione
 * Microsoft Dynamics NAV (SQL Server)
 */

import * as net from 'net';

import { z } from 'zod';

import { getNavDbConfig, getPool, runNavSync } from '@luke/nav';

import { logAudit } from '../lib/auditLog';
import { saveConfig, getConfig } from '../lib/configManager';
import {
  ErrorCode,
  createStandardError,
  toTRPCError,
} from '../lib/errorHandler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

const navConfigSchema = z.object({
  host: z.string().min(1, 'Host richiesto'),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1, 'Database richiesto'),
  user: z.string().min(1, 'Utente richiesto'),
  password: z.string().optional(),
  company: z.string().min(1, 'Company richiesto'),
  syncIntervalMinutes: z.number().int().min(1),
  readOnly: z.boolean(),
});

// ── Sync sub-router ───────────────────────────────────────────────────────────

const navSyncRouter = router({
  /**
   * Preview live: query diretta su NAV SQL Server (non sulla replica Postgres).
   * Restituisce i campi essenziali per la tabella di selezione.
   */
  preview: protectedProcedure
    .use(requirePermission('config:read'))
    .input(z.object({ entity: z.enum(['vendor']) }))
    .query(async ({ ctx }) => {
      const config = await getNavDbConfig(ctx.prisma, getConfig);
      const pool = await getPool(config);

      const tableName = `[${config.company}$Vendor]`;

      type NavVendorRow = {
        'No_': string;
        'Name': string;
        'City': string | null;
        'Country_Region Code': string | null;
        'Blocked': number;
      };

      let result;
      try {
        result = await pool.request().query<NavVendorRow>(`
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
    }))
    .mutation(async ({ input, ctx }) => {
      const navNos = input.mode === 'all' ? [] : input.navNos;

      const filter = await ctx.prisma.navSyncFilter.upsert({
        where: { entity: input.entity },
        create: { entity: input.entity, mode: input.mode, navNos, active: true },
        update: { mode: input.mode, navNos },
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
   * Esegue il sync manualmente on-demand.
   * Se entity è specificata, synca solo quella entità.
   * Restituisce i risultati con durationMs.
   */
  run: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ entity: z.string().optional() }))
    .mutation(async ({ ctx }) => {
      const report = await runNavSync(ctx.prisma, getConfig);

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

      return report.results.map(r => ({
        entity: r.entity,
        upserted: r.upserted,
        skipped: r.skipped,
        filterMode: r.filterMode,
        durationMs,
      }));
    }),
});

// ── Main router ───────────────────────────────────────────────────────────────

export const navRouter = router({
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(navConfigSchema)
    .mutation(async ({ input, ctx }) => {
      await saveConfig(ctx.prisma, 'integrations.nav.host', input.host, false);
      await saveConfig(ctx.prisma, 'integrations.nav.port', input.port.toString(), false);
      await saveConfig(ctx.prisma, 'integrations.nav.database', input.database, false);
      await saveConfig(ctx.prisma, 'integrations.nav.user', input.user, false);
      await saveConfig(ctx.prisma, 'integrations.nav.company', input.company, false);
      await saveConfig(ctx.prisma, 'integrations.nav.syncIntervalMinutes', input.syncIntervalMinutes.toString(), false);
      await saveConfig(ctx.prisma, 'integrations.nav.readOnly', input.readOnly.toString(), false);

      if (input.password && input.password.length > 0) {
        await saveConfig(ctx.prisma, 'integrations.nav.password', input.password, true);
      }

      ctx.logger.info(
        {
          host: input.host,
          port: input.port,
          database: input.database,
          user: input.user,
          company: input.company,
          syncIntervalMinutes: input.syncIntervalMinutes,
          readOnly: input.readOnly,
          passwordUpdated: !!input.password,
        },
        'Configurazione NAV salvata'
      );

      await logAudit(ctx, {
        action: 'CONFIG_NAV_UPDATE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: {
          host: input.host,
          port: input.port,
          database: input.database,
          user: input.user,
          company: input.company,
          syncIntervalMinutes: input.syncIntervalMinutes,
          readOnly: input.readOnly,
          passwordUpdated: !!input.password,
        },
      });

      return { success: true, message: 'Configurazione NAV salvata con successo' };
    }),

  testConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .mutation(async ({ ctx }) => {
      const [host, port] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.nav.host', false),
        getConfig(ctx.prisma, 'integrations.nav.port', false),
      ]);

      if (!host || !port) {
        const err = createStandardError(
          ErrorCode.CONFIG_ERROR,
          'Host e porta NAV non configurati. Salva prima la configurazione.'
        );
        throw toTRPCError(err);
      }

      const portNum = parseInt(port, 10);

      await new Promise<void>((resolve, reject) => {
        const socket = new net.Socket();
        const timeout = 5000;

        socket.setTimeout(timeout);

        socket.connect(portNum, host, () => {
          socket.destroy();
          resolve();
        });

        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error(`Timeout: impossibile raggiungere ${host}:${portNum} entro ${timeout / 1000}s`));
        });

        socket.on('error', (err: NodeJS.ErrnoException) => {
          socket.destroy();
          if (err.code === 'ECONNREFUSED') {
            reject(new Error(`Connessione rifiutata su ${host}:${portNum}. Verificare che SQL Server sia avviato e la porta sia aperta.`));
          } else {
            reject(new Error(`Errore di rete: ${err.message}`));
          }
        });
      }).catch((e: Error) => {
        const standardError = createStandardError(ErrorCode.CONNECTION_ERROR, e.message);
        throw toTRPCError(standardError);
      });

      return {
        success: true,
        message: `Connessione TCP a ${host}:${portNum} riuscita.`,
      };
    }),

  sync: navSyncRouter,
});
