/**
 * Zod schemas for SMTP mail configuration — shared between API and frontend.
 */

import { z } from 'zod';

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
  port: z
    .number()
    .int()
    .min(1, 'Porta deve essere tra 1 e 65535')
    .max(65535, 'Porta deve essere tra 1 e 65535'),
  secure: z.boolean(),
  user: z.string().min(1, 'Username richiesto'),
  pass: z.string().optional().or(z.literal('')),
  from: smtpFromSchema,
  baseUrl: z.string().url('URL valido richiesto'),
});

/** Input schema for triggering a test email. Defaults to the configured sender (`smtp.from`) if omitted. */
export const mailTestSchema = z.object({
  testEmail: z.string().email().optional(),
});

// Types inferred from the schemas
export type MailSmtpConfigInput = z.infer<typeof mailSmtpConfigSchema>;
export type MailTestInput = z.infer<typeof mailTestSchema>;
