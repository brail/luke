/**
 * Zod schemas for SMTP mail configuration — shared between API and frontend.
 */

import { z } from 'zod';

import { PortSchema } from './number.js';
import { httpUrl } from './url.js';

/**
 * SMTP sender: `email@domain.com` or `Name <email@domain.com>`. A format check, not strict address
 * validation. Also the `smtp.from` entry of `AppConfigRegistry`, so the form input and the stored
 * value cannot disagree.
 */
export const smtpFromSchema = z
  .string()
  .min(1, 'Mittente richiesto')
  .refine(
    v => /^[^<>]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    'Formato valido: email@dominio.com oppure Nome <email@dominio.com>'
  );

/** Input schema for saving SMTP configuration, shared by the settings form and the API. */
export const mailSmtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP richiesto'),
  port: PortSchema,
  secure: z.boolean(),
  user: z.string().min(1, 'Username richiesto'),
  pass: z.string().optional().or(z.literal('')),
  from: smtpFromSchema,
  // Empty keeps the stored base URL, which the page cannot show back when it is stored encrypted.
  baseUrl: httpUrl('URL valido richiesto').or(z.literal('')),
});

/** Input schema for triggering a test email. Defaults to the configured sender (`smtp.from`) if omitted. */
export const mailTestSchema = z.object({
  testEmail: z.email().optional(),
});

// Types inferred from the schemas
export type MailSmtpConfigInput = z.infer<typeof mailSmtpConfigSchema>;
export type MailTestInput = z.infer<typeof mailTestSchema>;
