/**
 * Mail sub-router for integrations
 * Handles SMTP configuration and testing
 */

import { TRPCError } from '@trpc/server';
import nodemailer from 'nodemailer';

import { mailSmtpConfigSchema, mailTestSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfigForForm, getConfigsMasked, rethrowUnreadable, saveConfigs } from '../lib/configManager';
import { externalCheckFailed } from '../lib/errorHandler';
import { getSmtpConfig } from '../lib/mailer';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

/** The fixed text of a failed SMTP test (#193): a refused login or envelope told apart. */
function smtpTestFailureMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'EAUTH') return 'Accesso SMTP rifiutato: credenziali non valide';
  if (code === 'EENVELOPE') return 'Invio di prova rifiutato: verifica destinatario e mittente';
  return 'Test SMTP fallito: verifica server, porta e sicurezza';
}

export const mailRouter = router({
  /**
   * Whether a password is stored, and whether it does not decrypt, for the settings page to show:
   * the masked rows it reads cannot tell. An unreadable one reports as not stored.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ hasPassword: boolean, passwordUnreadable: boolean }}
   */
  getPasswordState: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      const { value, unreadable } = await getConfigForForm(ctx.prisma, 'smtp.pass');
      return { hasPassword: !!value, passwordUnreadable: unreadable };
    }),

  /**
   * Saves the SMTP configuration to AppConfig; password is stored encrypted.
   *
   * @auth {config:update}
   * @input {mailSmtpConfigSchema} — host, port, secure, user, optional pass, from, optional baseUrl.
   * @output {{ success: true, message: string }}
   */
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(mailSmtpConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // An empty base URL keeps the stored one only when the page could not show it: stored
      // encrypted. Otherwise it is a missing value, and every email link would point at the default.
      if (!input.baseUrl && !(await getConfigsMasked(ctx.prisma, ['app.baseUrl']))[0]?.isEncrypted) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'URL valido richiesto' });
      }

      // One change: a failure leaves the stored SMTP settings as they were. A blank password or
      // base URL keeps the stored one: the page cannot read either back.
      await saveConfigs(ctx.prisma, [
        { key: 'smtp.host', value: input.host },
        { key: 'smtp.port', value: input.port.toString() },
        { key: 'smtp.secure', value: input.secure.toString() },
        { key: 'smtp.user', value: input.user },
        { key: 'smtp.from', value: input.from },
        ...(input.baseUrl ? [{ key: 'app.baseUrl' as const, value: input.baseUrl }] : []),
        ...(input.pass ? [{ key: 'smtp.pass' as const, value: input.pass, encrypt: true }] : []),
      ]);

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
        'SMTP configuration saved'
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
    .input(mailTestSchema)
    .mutation(async ({ input, ctx }) => {
      // Outside the `try` below: an incomplete configuration answers PRECONDITION_FAILED from here,
      // an unreadable one asks for the value again, and a database failure stays a server error
      // rather than read as an SMTP refusal (#193).
      const smtp = await getSmtpConfig(ctx.prisma).catch(rethrowUnreadable);
      try {
        const transporter = nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure, // true for SSL/TLS, false for STARTTLS
          auth: smtp.auth,
        });

        // Verifies the connection
        await transporter.verify();

        // Determines recipient: parameter or configured sender
        const recipient = input.testEmail || smtp.from;

        // Sends test email
        const testEmail = {
          from: smtp.from,
          to: recipient,
          subject: 'Luke - Test Email Configurazione SMTP',
          text: "Questa è un'email di test da Luke. Se ricevi questa email, la configurazione SMTP funziona correttamente!",
          html: "<p>Questa è un'email di test da <strong>Luke</strong>.</p><p>Se ricevi questa email, la configurazione SMTP funziona correttamente!</p>",
        };

        await transporter.sendMail(testEmail);

        ctx.logger.info({ to: recipient, subject: testEmail.subject }, 'Test email sent successfully');

        return {
          success: true,
          message: 'Email di test inviata con successo',
          sentTo: recipient,
        };
      } catch (error: unknown) {
        // The client sees a fixed text; the server's reply goes to this log only (#193).
        ctx.logger.warn({ err: error }, 'SMTP test failed');
        throw externalCheckFailed(smtpTestFailureMessage(error));
      }
    }),
});
