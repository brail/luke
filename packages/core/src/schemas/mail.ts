/**
 * Zod schemas for SMTP mail configuration — shared between API and frontend.
 */

import { z } from 'zod';

/**
 * Input schema for saving SMTP configuration.
 * `from` accepts both `email@domain.com` and `Name <email@domain.com>` formats.
 */
export const mailSmtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP richiesto'),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string().min(1, 'Username richiesto'),
  pass: z.string().optional().or(z.literal('')),
  from: z
    .string()
    .min(1, 'Mittente richiesto')
    .refine(
      v => /^[^<>]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Formato valido: email@dominio.com oppure Nome <email@dominio.com>'
    ),
  baseUrl: z.string().url('URL valido richiesto'),
});

/** Input schema for triggering a test email. Defaults to the currently authenticated user's address if omitted. */
export const mailTestSchema = z.object({
  testEmail: z.string().email().optional(),
});

// Types inferred from the schemas
export type MailSmtpConfigInput = z.infer<typeof mailSmtpConfigSchema>;
export type MailTestInput = z.infer<typeof mailTestSchema>;
