/**
 * NAV sub-router per integrazioni
 * Gestisce configurazione e test connessione Microsoft NAV (SQL Server)
 */

import * as net from 'net';

import { z } from 'zod';

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
});
