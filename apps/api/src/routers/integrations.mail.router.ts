/**
 * Mail sub-router for integrations
 * Handles SMTP configuration and testing
 */

import * as nodemailer from 'nodemailer';
import { z } from 'zod';

import { logAudit } from '../lib/auditLog';
import { saveConfig, getConfig } from '../lib/configManager';
import {
  ErrorCode,
  createStandardError,
  toTRPCError,
  IntegrationErrorHandler,
  SecureLogger,
} from '../lib/errorHandler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

// Schema for SMTP configuration
const smtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP è obbligatorio'),
  port: z.number().min(1).max(65535, 'Porta deve essere tra 1 e 65535'),
  secure: z.boolean().default(false),
  user: z.string().min(1, 'User SMTP è obbligatorio'),
  pass: z.string().optional(), // Optional for update without changing password
  from: z.string().min(1, 'Email mittente è obbligatoria'),
  baseUrl: z.string().url('Base URL deve essere un URL valido'),
});

export const mailRouter = router({
  /**
   * Saves the SMTP configuration to AppConfig; password is stored encrypted.
   *
   * @auth {config:update}
   * @input {smtpConfigSchema} — host, port, secure, user, optional pass, from, baseUrl.
   * @output {{ success: true, message: string }}
   */
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(smtpConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Saves each field separately in AppConfig
      await saveConfig(ctx.prisma, 'smtp.host', input.host, false);
      await saveConfig(ctx.prisma, 'smtp.port', input.port.toString(), false);
      await saveConfig(
        ctx.prisma,
        'smtp.secure',
        input.secure.toString(),
        false
      );
      await saveConfig(ctx.prisma, 'smtp.user', input.user, false);
      await saveConfig(ctx.prisma, 'smtp.from', input.from, false);
      await saveConfig(ctx.prisma, 'app.baseUrl', input.baseUrl, false);

      // Saves password only if provided (encrypted)
      if (input.pass && input.pass.length > 0) {
        await saveConfig(ctx.prisma, 'smtp.pass', input.pass, true);
      }

      ctx.logger.info(
        {
          host: input.host,
          port: input.port,
          secure: input.secure,
          user: input.user,
          from: input.from,
          baseUrl: input.baseUrl,
          passwordUpdated: !!input.pass,
        },
        'Configurazione SMTP salvata'
      );

      // Audit log
      await logAudit(ctx, {
        action: 'CONFIG_SMTP_UPDATE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: {
          host: input.host,
          port: input.port,
          secure: input.secure,
          passwordUpdated: !!input.pass,
        },
      });

      return {
        success: true,
        message: 'Configurazione SMTP salvata con successo',
      };
    }),

  /**
   * Tests the SMTP connection and sends a test email to the configured sender or a custom address.
   *
   * @auth {config:read}
   * @input {{ testEmail?: string }} — optional override for the test recipient address.
   * @output {{ success: true, message: string, sentTo: string }}
   */
  test: protectedProcedure
    .use(requirePermission('config:read'))
    .input(
      z.object({
        testEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const logger = new SecureLogger(ctx.logger);

        // Fetches SMTP configuration from individual AppConfig fields
        const [host, port, secure, user, pass, from] = await Promise.all([
          getConfig(ctx.prisma, 'smtp.host', false),
          getConfig(ctx.prisma, 'smtp.port', false),
          getConfig(ctx.prisma, 'smtp.secure', false),
          getConfig(ctx.prisma, 'smtp.user', false),
          getConfig(ctx.prisma, 'smtp.pass', true), // Decrypts password
          getConfig(ctx.prisma, 'smtp.from', false),
        ]);

        // Verifies all fields are configured
        if (!host || !port || !user || !pass || !from) {
          const standardError = createStandardError(
            ErrorCode.CONFIG_ERROR,
            'Configurazione SMTP incompleta. Verifica che tutti i campi siano configurati.'
          );
          throw toTRPCError(standardError);
        }

        // Creates nodemailer transporter
        const transporter = nodemailer.createTransport({
          host,
          port: parseInt(port, 10),
          secure: secure === 'true', // true for SSL/TLS, false for STARTTLS
          auth: {
            user,
            pass,
          },
        });

        // Verifies the connection
        await transporter.verify();

        // Determines recipient: parameter or configured sender
        const recipient = input.testEmail || from;

        // Sends test email
        const testEmail = {
          from,
          to: recipient,
          subject: 'Luke - Test Email Configurazione SMTP',
          text: "Questa è un'email di test da Luke. Se ricevi questa email, la configurazione SMTP funziona correttamente!",
          html: "<p>Questa è un'email di test da <strong>Luke</strong>.</p><p>Se ricevi questa email, la configurazione SMTP funziona correttamente!</p>",
        };

        await transporter.sendMail(testEmail);

        logger.info('Email di test inviata con successo', {
          to: recipient,
          subject: testEmail.subject,
        });

        return {
          success: true,
          message: 'Email di test inviata con successo',
          sentTo: recipient,
        };
      } catch (error: unknown) {
        const standardError = IntegrationErrorHandler.handleSMTPError(error);
        throw toTRPCError(standardError);
      }
    }),
});
