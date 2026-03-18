/**
 * Storage sub-router per integrazioni
 * Gestisce configurazione e test connessione per SMB e Google Drive
 */

import { z } from 'zod';

import {
  toTRPCError,
  IntegrationErrorHandler,
  SecureLogger,
} from '../lib/errorHandler';
import { saveConfig } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

// Schema per configurazione SMB
const smbConfigSchema = z.object({
  host: z.string().min(1, 'Host è obbligatorio'),
  path: z.string().min(1, 'Path è obbligatorio'),
  username: z.string().optional(),
  password: z.string().optional(),
});

// Schema per configurazione Google Drive OAuth
const driveConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID è obbligatorio'),
  clientSecret: z.string().min(1, 'Client Secret è obbligatorio'),
  refreshToken: z.string().min(1, 'Refresh Token è obbligatorio'),
});

export const storageRouter = router({
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(
      z.object({
        provider: z.enum(['smb', 'drive']),
        config: z.union([smbConfigSchema, driveConfigSchema]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        ctx.logger.info(
          { provider: input.provider },
          'Storage config save request'
        );
        const { provider, config } = input;
        const configKey = `storage.${provider}`;
        const logger = new SecureLogger(console);

        // Cifra le credenziali sensibili
        let configToSave = { ...config };

        if (provider === 'smb' && 'password' in config && config.password) {
          configToSave = {
            ...configToSave,
            password: '[REDACTED]', // Per i log
          };
        }

        if (
          provider === 'drive' &&
          'clientSecret' in config &&
          config.clientSecret
        ) {
          configToSave = {
            ...configToSave,
            clientSecret: '[REDACTED]', // Per i log
          };
        }

        // Salva la configurazione cifrata
        const configValue = JSON.stringify(config);
        await saveConfig(ctx.prisma, configKey, configValue, true);

        logger.info(`Configurazione storage ${provider} salvata`, {
          provider,
          config: configToSave,
        });

        return {
          success: true,
          message: `Configurazione ${provider.toUpperCase()} salvata con successo`,
        };
      } catch (error: any) {
        const standardError = IntegrationErrorHandler.handleConfigError(
          `storage.${input.provider}`,
          error
        );
        throw toTRPCError(standardError);
      }
    }),

  testConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .input(
      z.object({
        provider: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { provider } = input;

      // Per ora restituisce un placeholder
      // In futuro qui si implementerà la logica di test reale
      ctx.logger.info({ provider }, 'Test connessione storage (placeholder)');

      return {
        success: true,
        message: `Connessione ${provider.toUpperCase()} OK (placeholder)`,
      };
    }),
});
