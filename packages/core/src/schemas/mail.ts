/**
 * Zod schemas for SMTP mail configuration — shared between API and frontend.
 * The `pass` field is omitted from response schemas and replaced with `hasPassword`.
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

/** Response shape for `getMailConfig`. The password is replaced with a `hasPassword` boolean flag. */
export const mailSmtpConfigResponseSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  hasPassword: z.boolean(),
  from: z.string(),
  baseUrl: z.string(),
});

/** Input schema for triggering a test email. Defaults to the currently authenticated user's address if omitted. */
export const mailTestSchema = z.object({
  testEmail: z.string().email().optional(),
});

/** Response shape for a test email operation, including the actual recipient address used. */
export const mailTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  sentTo: z.string().optional(),
});

/** Generic success/failure response for mail write operations (save, test). */
export const mailOperationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Tipi inferiti dagli schema
export type MailSmtpConfigInput = z.infer<typeof mailSmtpConfigSchema>;
export type MailSmtpConfigResponse = z.infer<
  typeof mailSmtpConfigResponseSchema
>;
export type MailTestInput = z.infer<typeof mailTestSchema>;
export type MailTestResponse = z.infer<typeof mailTestResponseSchema>;
export type MailOperationResponse = z.infer<typeof mailOperationResponseSchema>;
