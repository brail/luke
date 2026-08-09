/**
 * Storage sub-router for integrations
 * Handles configuration and connection testing for SMB and Google Drive
 */

import { z } from 'zod';

import { saveConfig } from '../lib/configManager';
import {
  toTRPCError,
  IntegrationErrorHandler,
  SecureLogger,
} from '../lib/errorHandler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

// Schema for SMB configuration
const smbConfigSchema = z.object({
  host: z.string().min(1, 'Host è obbligatorio'),
  path: z.string().min(1, 'Path è obbligatorio'),
  username: z.string().optional(),
  password: z.string().optional(),
});

// Schema for Google Drive OAuth configuration
const driveConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID è obbligatorio'),
  clientSecret: z.string().min(1, 'Client Secret è obbligatorio'),
  refreshToken: z.string().min(1, 'Refresh Token è obbligatorio'),
});

export const storageRouter = router({
  /**
   * Saves the legacy SMB or Google Drive storage provider configuration (encrypted).
   *
   * @auth {config:update}
   * @input {{ provider: "smb"|"drive", config: smbConfigSchema | driveConfigSchema }}
   * @output {{ success: true, message: string }}
   */
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
        const logger = new SecureLogger(ctx.logger);

        // Encrypts the sensitive credentials
        let configToSave = { ...config };

        if (provider === 'smb' && 'password' in config && config.password) {
          configToSave = {
            ...configToSave,
            password: '[REDACTED]', // For logs
          };
        }

        if (
          provider === 'drive' &&
          'clientSecret' in config &&
          config.clientSecret
        ) {
          configToSave = {
            ...configToSave,
            clientSecret: '[REDACTED]', // For logs
          };
        }

        // Saves the encrypted configuration
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
      } catch (error: unknown) {
        const standardError = IntegrationErrorHandler.handleConfigError(
          `storage.${input.provider}`,
          error
        );
        throw toTRPCError(standardError);
      }
    }),

  /**
   * Placeholder: tests the SMB or Drive storage connection (not yet implemented).
   *
   * @auth {config:read}
   * @input {{ provider: string }}
   * @output {{ success: true, message: string }}
   */
  testConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .input(
      z.object({
        provider: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { provider } = input;

      // For now returns a placeholder
      // The real test logic will be implemented here in the future
      ctx.logger.info({ provider }, 'Test connessione storage (placeholder)');

      return {
        success: true,
        message: `Connessione ${provider.toUpperCase()} OK (placeholder)`,
      };
    }),
});
