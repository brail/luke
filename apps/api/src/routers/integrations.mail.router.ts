/**
 * Mail sub-router per integrazioni
 * Gestisce configurazione e test SMTP
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

// Schema per configurazione SMTP
const smtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP è obbligatorio'),
  port: z.number().min(1).max(65535, 'Porta deve essere tra 1 e 65535'),
  secure: z.boolean().default(false),
  user: z.string().min(1, 'User SMTP è obbligatorio'),
  pass: z.string().optional(), // Opzionale per aggiornamento senza cambiare password
  from: z.string().min(1, 'Email mittente è obbligatoria'),
  baseUrl: z.string().url('Base URL deve essere un URL valido'),
});

export const mailRouter = router({
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(smtpConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Salva ogni campo separatamente in AppConfig
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

      // Salva password solo se fornita (cifrata)
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

      // Log audit
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

  test: protectedProcedure
    .use(requirePermission('config:read'))
    .input(
      z.object({
        testEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const logger = new SecureLogger(console);

        // Recupera la configurazione SMTP dai singoli campi AppConfig
        const [host, port, secure, user, pass, from] = await Promise.all([
          getConfig(ctx.prisma, 'smtp.host', false),
          getConfig(ctx.prisma, 'smtp.port', false),
          getConfig(ctx.prisma, 'smtp.secure', false),
          getConfig(ctx.prisma, 'smtp.user', false),
          getConfig(ctx.prisma, 'smtp.pass', true), // Decifra password
          getConfig(ctx.prisma, 'smtp.from', false),
        ]);

        // Verifica che tutti i campi siano configurati
        if (!host || !port || !user || !pass || !from) {
          const standardError = createStandardError(
            ErrorCode.CONFIG_ERROR,
            'Configurazione SMTP incompleta. Verifica che tutti i campi siano configurati.'
          );
          throw toTRPCError(standardError);
        }

        // Crea transporter nodemailer
        const transporter = nodemailer.createTransport({
          host,
          port: parseInt(port, 10),
          secure: secure === 'true', // true per SSL/TLS, false per STARTTLS
          auth: {
            user,
            pass,
          },
        });

        // Verifica la connessione
        await transporter.verify();

        // Determina il destinatario: parametro o mittente configurato
        const recipient = input.testEmail || from;

        // Invia email di test
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
      } catch (error: any) {
        const standardError = IntegrationErrorHandler.handleSMTPError(error);
        throw toTRPCError(standardError);
      }
    }),
});
