/**
 * Mailer per Luke API
 * Gestisce l'invio di email transazionali tramite Nodemailer
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import nodemailer from 'nodemailer';
import pino from 'pino';

import { getConfig } from './configManager';

import type { PrismaClient } from '@prisma/client';
import type Mail from 'nodemailer/lib/mailer';

const logger = pino({ level: 'info' });

/**
 * Configurazione SMTP recuperata da AppConfig
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

/**
 * Recupera la configurazione SMTP da AppConfig
 * @param prisma - Client Prisma
 * @returns Configurazione SMTP
 * @throws Error se le configurazioni SMTP non sono complete
 */
export async function getSmtpConfig(prisma: PrismaClient): Promise<SmtpConfig> {
  const [host, port, secure, user, pass, from] = await Promise.all([
    getConfig(prisma, 'smtp.host', false),
    getConfig(prisma, 'smtp.port', false),
    getConfig(prisma, 'smtp.secure', false),
    getConfig(prisma, 'smtp.user', false),
    getConfig(prisma, 'smtp.pass', true), // Decifrare password
    getConfig(prisma, 'smtp.from', false),
  ]);

  if (!host || !port || !user || !pass || !from) {
    throw new Error(
      'Configurazione SMTP incompleta. Verifica che smtp.host, smtp.port, smtp.user, smtp.pass e smtp.from siano configurati in AppConfig.'
    );
  }

  return {
    host,
    port: parseInt(port, 10),
    secure: secure === 'true',
    auth: {
      user,
      pass,
    },
    from,
  };
}

/**
 * Invia un'email generica con retry automatico
 * @param prisma - Client Prisma per recuperare config SMTP
 * @param to - Destinatario
 * @param subject - Oggetto email
 * @param html - Contenuto HTML
 * @param text - Contenuto testo plain
 */
export async function sendEmail(
  prisma: PrismaClient,
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<void> {
  const retries = 3;
  const backoffMs = [250, 500, 1000];

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const smtpConfig = await getSmtpConfig(prisma);

      // Crea transporter Nodemailer
      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: smtpConfig.auth,
      });

      const mailOptions: Mail.Options = {
        from: smtpConfig.from,
        to,
        subject,
        text,
        html,
      };

      await transporter.sendMail(mailOptions);

      logger.info({ to, subject, attempt: attempt + 1 }, 'Email inviata');
      return;
    } catch (error) {
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) {
        logger.warn(
          {
            to,
            subject,
            attempts: retries,
            error: error instanceof Error ? error.message : 'Unknown',
          },
          'Email fallita dopo tutti i retry'
        );
        throw new Error(
          `Impossibile inviare email: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      // Backoff esponenziale prima del prossimo tentativo
      await new Promise(resolve => setTimeout(resolve, backoffMs[attempt]));
    }
  }
}

/**
 * Carica template testo e sostituisce placeholder
 */
function loadTextTemplate(
  templateName: string,
  variables: Record<string, string>
): string {
  const templatePath = join(__dirname, '../templates', `${templateName}.txt`);
  let template = readFileSync(templatePath, 'utf-8');
  Object.entries(variables).forEach(([key, value]) => {
    template = template.replace(new RegExp(`{{${key}}}`, 'g'), value);
  });
  return template;
}

/**
 * Genera template HTML branded con logo Luke (DRY)
 */
function generateBrandedHtml(
  title: string,
  heading: string,
  message: string,
  buttonText: string,
  buttonUrl: string,
  note: string
): string {
  const year = new Date().getFullYear();
  return `<!doctype html><html lang="it"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f9fafb"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><tr><td style="padding:40px 40px 32px;text-align:center;border-bottom:1px solid #e5e7eb"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 629.54 628.34" width="64" height="64" style="display:inline-block"><g fill="#1e293b"><circle cx="379.54" cy="50" r="14.49"/><circle cx="250.6" cy="51.45" r="15.1"/><circle cx="378.42" cy="121.64" r="28.65"/><circle cx="250.62" cy="121.8" r="28.65"/><circle cx="122.32" cy="121.83" r="28.65"/><circle cx="506.56" cy="122.38" r="28.65"/><circle cx="385.8" cy="242.42" r="50.26"/><circle cx="244.16" cy="242.67" r="50.26"/><circle cx="579.54" cy="250" r="14.49"/><circle cx="507.19" cy="250.41" r="29.6"/><circle cx="51.09" cy="250.5" r="14.49"/><circle cx="122.98" cy="250.83" r="29.6"/><circle cx="506.63" cy="377.52" r="29.6"/><circle cx="578.37" cy="377.78" r="14.49"/><circle cx="122.54" cy="377.89" r="29.6"/><circle cx="50" cy="378.34" r="14.49"/><circle cx="385.78" cy="385.72" r="50.26"/><circle cx="244.22" cy="385.89" r="50.26"/><circle cx="123.16" cy="506.26" r="28.65"/><circle cx="379.04" cy="506.85" r="28.65"/><circle cx="507.31" cy="506.91" r="28.65"/><circle cx="251.27" cy="507.02" r="28.65"/><circle cx="378.9" cy="576.86" r="15.1"/><circle cx="250" cy="578.34" r="14.49"/></g></svg><h1 style="margin:16px 0 0;font-size:28px;font-weight:700;color:#1e293b;letter-spacing:-.5px">Luke</h1></td></tr><tr><td style="padding:40px"><h2 style="margin:0 0 24px;font-size:24px;font-weight:600;color:#1e293b">${heading}</h2><p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569">${message}</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0"><tr><td align="center"><a href="${buttonUrl}" style="display:inline-block;padding:14px 32px;background-color:#1e293b;color:#f8fafc;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;letter-spacing:.3px">${buttonText}</a></td></tr></table><p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#64748b">Se il pulsante non funziona, copia questo link:<br/><span style="color:#3b82f6;word-break:break-all">${buttonUrl}</span></p><div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb"><p style="margin:0;font-size:13px;line-height:1.5;color:#94a3b8"><strong>Nota:</strong> ${note}</p></div></td></tr><tr><td style="padding:24px 40px;background-color:#f8fafc;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px"><p style="margin:0;font-size:13px;text-align:center;color:#94a3b8">© ${year} Luke. Tutti i diritti riservati.</p></td></tr></table></td></tr></table></body></html>`;
}

/**
 * Invia email per reset password
 * @param prisma - Client Prisma
 * @param to - Email destinatario
 * @param token - Token di reset (in chiaro)
 * @param baseUrl - Base URL dell'applicazione
 */
export async function sendPasswordResetEmail(
  prisma: PrismaClient,
  to: string,
  token: string,
  baseUrl: string
): Promise<void> {
  const resetUrl = `${baseUrl}/auth/reset?token=${token}`;
  const subject = 'Reset Password - Luke';

  const html = generateBrandedHtml(
    'Reset Password - Luke',
    'Reimposta la tua password',
    'Abbiamo ricevuto una richiesta per reimpostare la password del tuo account. Clicca sul pulsante qui sotto per procedere:',
    'Reset Password',
    resetUrl,
    'Questo link è valido per 30 minuti. Se non hai richiesto il reset, ignora questa email.'
  );

  const text = loadTextTemplate('reset', {
    resetUrl,
    year: new Date().getFullYear().toString(),
  });

  await sendEmail(prisma, to, subject, html, text);
}

/**
 * Invia email per verifica indirizzo email
 * @param prisma - Client Prisma
 * @param to - Email destinatario
 * @param token - Token di verifica (in chiaro)
 * @param baseUrl - Base URL dell'applicazione
 */
export async function sendEmailVerificationEmail(
  prisma: PrismaClient,
  to: string,
  token: string,
  baseUrl: string
): Promise<void> {
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;
  const subject = 'Verifica Email - Luke';

  const html = generateBrandedHtml(
    'Verifica Email - Luke',
    'Verifica il tuo indirizzo email',
    'Grazie per esserti registrato! Per completare la configurazione del tuo account, verifica il tuo indirizzo email cliccando sul pulsante qui sotto:',
    'Verifica Email',
    verifyUrl,
    'Questo link è valido per 24 ore. Se non hai richiesto questa verifica, ignora questa email.'
  );

  const text = loadTextTemplate('verify', {
    verifyUrl,
    year: new Date().getFullYear().toString(),
  });

  await sendEmail(prisma, to, subject, html, text);
}
