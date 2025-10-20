/**
 * Schema Zod per configurazione Mail SMTP
 * Centralizzato in @luke/core per riuso tra API e frontend
 */

import { z } from 'zod';

/**
 * Schema per configurazione SMTP (input per saveConfig)
 */
export const mailSmtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP richiesto'),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string().min(1, 'Username richiesto'),
  pass: z.string().optional().or(z.literal('')),
  from: z.string().email('Email valida richiesta'),
  baseUrl: z.string().url('URL valido richiesto'),
});

/**
 * Schema per risposta getMailConfig (output con dati sensibili omessi)
 */
export const mailSmtpConfigResponseSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  hasPassword: z.boolean(),
  from: z.string(),
  baseUrl: z.string(),
});

/**
 * Schema per test email
 */
export const mailTestSchema = z.object({
  testEmail: z.string().email().optional(),
});

/**
 * Schema per risposta test email
 */
export const mailTestResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  sentTo: z.string().optional(),
});

/**
 * Schema per risposta operazioni mail
 */
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
