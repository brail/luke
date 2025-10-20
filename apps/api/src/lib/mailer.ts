/**
 * Mailer per Luke API
 * Gestisce l'invio di email transazionali tramite Nodemailer
 */

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
 * Invia un'email generica
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

    logger.info({ to, subject }, 'Email inviata con successo');
  } catch (error) {
    logger.error(
      {
        to,
        subject,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Errore invio email'
    );
    throw new Error(
      `Impossibile inviare email: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Genera template HTML semplice per email
 */
function generateEmailTemplate(
  title: string,
  body: string,
  buttonText?: string,
  buttonUrl?: string
): string {
  return `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f4f4f4; padding: 20px; border-radius: 5px;">
    <h2 style="color: #2c3e50; margin-top: 0;">${title}</h2>
    <p style="margin: 15px 0;">${body}</p>
    ${
      buttonText && buttonUrl
        ? `
    <div style="text-align: center; margin: 30px 0;">
      <a href="${buttonUrl}" style="display: inline-block; padding: 12px 30px; background-color: #3498db; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">
        ${buttonText}
      </a>
    </div>
    `
        : ''
    }
    <p style="margin: 20px 0 0 0; font-size: 12px; color: #7f8c8d;">
      Questa è un'email automatica generata da Luke. Per favore non rispondere a questa email.
    </p>
  </div>
</body>
</html>
  `.trim();
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

  const text = `
Ciao,

Hai richiesto di reimpostare la tua password su Luke.

Clicca sul seguente link per procedere:
${resetUrl}

Questo link è valido per 30 minuti.

Se non hai richiesto il reset della password, ignora questa email.

---
Luke Team
  `.trim();

  const html = generateEmailTemplate(
    'Reset Password',
    'Hai richiesto di reimpostare la tua password. Clicca sul pulsante qui sotto per procedere.',
    'Reimposta Password',
    resetUrl
  );

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

  const text = `
Ciao,

Grazie per esserti registrato su Luke!

Per completare la registrazione, verifica il tuo indirizzo email cliccando sul seguente link:
${verifyUrl}

Questo link è valido per 24 ore.

Se non ti sei registrato su Luke, ignora questa email.

---
Luke Team
  `.trim();

  const html = generateEmailTemplate(
    'Verifica Email',
    'Grazie per esserti registrato su Luke! Per completare la registrazione, verifica il tuo indirizzo email cliccando sul pulsante qui sotto.',
    'Verifica Email',
    verifyUrl
  );

  await sendEmail(prisma, to, subject, html, text);
}

