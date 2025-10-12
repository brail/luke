/**
 * Integrations Router per Luke API
 * Gestisce configurazioni e test per Storage, Mail e Import/Export
 */

import { z } from 'zod';
import { router, publicProcedure } from '../lib/trpc';
import { saveConfig, getConfig } from '../lib/configManager';
import * as nodemailer from 'nodemailer';
import {
  ErrorCode,
  createStandardError,
  toTRPCError,
  IntegrationErrorHandler,
  SecureLogger,
} from '../lib/errorHandler';

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

// Schema per configurazione SMTP
const smtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP è obbligatorio'),
  port: z.number().min(1).max(65535, 'Porta deve essere tra 1 e 65535'),
  username: z.string().min(1, 'Username è obbligatorio'),
  password: z.string().min(1, 'Password è obbligatoria'),
  from: z.string().email('Email mittente non valida'),
});

export const integrationsRouter = router({
  // Endpoint di test per verificare che le mutation funzionino
  test: publicProcedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ input }) => {
      console.log('🔍 Test mutation received:', input);
      return {
        success: true,
        message: `Test mutation received: ${input.message}`,
      };
    }),

  storage: router({
    saveConfig: publicProcedure
      .input(
        z.object({
          provider: z.enum(['smb', 'drive']),
          config: z.union([smbConfigSchema, driveConfigSchema]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          console.log('🔍 Received input:', JSON.stringify(input, null, 2));
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

          logger.info(`💾 Configurazione storage ${provider} salvata`, {
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

    testConnection: publicProcedure
      .input(
        z.object({
          provider: z.string(),
        })
      )
      .query(async ({ input, ctx }) => {
        const { provider } = input;

        // Per ora restituisce un placeholder
        // In futuro qui si implementerà la logica di test reale
        console.log(`🔍 Test connessione storage ${provider} (placeholder)`);

        return {
          success: true,
          message: `Connessione ${provider.toUpperCase()} OK (placeholder)`,
        };
      }),
  }),

  mail: router({
    saveConfig: publicProcedure
      .input(smtpConfigSchema)
      .mutation(async ({ input, ctx }) => {
        const configKey = 'mail.smtp';

        // Cifra la password
        const configToSave = {
          ...input,
          password: '[REDACTED]', // Per i log
        };

        // Salva la configurazione cifrata
        const configValue = JSON.stringify(input);
        await saveConfig(ctx.prisma, configKey, configValue, true);

        console.log('📧 Configurazione SMTP salvata:', configToSave);

        return {
          success: true,
          message: 'Configurazione SMTP salvata con successo',
        };
      }),

    test: publicProcedure.mutation(async ({ ctx }) => {
      try {
        const logger = new SecureLogger(console);

        // Recupera la configurazione SMTP
        const configValue = await getConfig(ctx.prisma, 'mail.smtp', true);

        if (!configValue) {
          const standardError = createStandardError(
            ErrorCode.CONFIG_ERROR,
            'Configurazione SMTP non trovata'
          );
          throw toTRPCError(standardError);
        }

        const config = JSON.parse(configValue);

        // Crea transporter nodemailer
        const transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.port === 465, // true per 465, false per altri
          auth: {
            user: config.username,
            pass: config.password,
          },
        });

        // Verifica la connessione
        await transporter.verify();

        // Invia email di test
        const testEmail = {
          from: config.from,
          to: config.from, // Invia a se stesso per il test
          subject: 'Luke - Test Email',
          text: "Questa è un'email di test da Luke.",
          html: "<p>Questa è un'email di test da <strong>Luke</strong>.</p>",
        };

        await transporter.sendMail(testEmail);

        logger.info('✅ Email di test inviata con successo', {
          to: config.from,
          subject: testEmail.subject,
        });

        return {
          success: true,
          message: 'Email di test inviata con successo',
        };
      } catch (error: any) {
        const standardError = IntegrationErrorHandler.handleSMTPError(error);
        throw toTRPCError(standardError);
      }
    }),
  }),

  importExport: router({
    startImport: publicProcedure
      .input(
        z.object({
          filename: z.string().min(1, 'Nome file è obbligatorio'),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { filename } = input;

        console.log(`📥 Import avviato per file: ${filename}`);

        // Placeholder per la logica di import
        // In futuro qui si implementerà l'import reale

        return {
          success: true,
          message: `Import avviato per file: ${filename} (placeholder)`,
        };
      }),

    startExport: publicProcedure
      .input(
        z.object({
          type: z.string().min(1, 'Tipo export è obbligatorio'),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { type } = input;

        console.log(`📤 Export avviato per tipo: ${type}`);

        // Placeholder per la logica di export
        // In futuro qui si implementerà l'export reale
        const placeholderUrl = `/api/export/${type}-${Date.now()}.json`;

        return {
          success: true,
          message: `Export avviato per tipo: ${type}`,
          url: placeholderUrl,
        };
      }),
  }),
});
