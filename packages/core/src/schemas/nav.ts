/**
 * Schema Zod per configurazione Microsoft NAV (SQL Server)
 * Centralizzato in @luke/core per riuso tra API e frontend
 */

import { z } from 'zod';

/**
 * Schema per configurazione NAV (input per saveConfig)
 */
export const navConfigSchema = z.object({
  host: z.string().min(1, 'Host richiesto'),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1, 'Database richiesto'),
  user: z.string().min(1, 'Utente richiesto'),
  password: z.string().optional(),
  company: z.string().min(1, 'Company richiesto'),
  syncIntervalMinutes: z.number().int().min(1),
  readOnly: z.boolean(),
});

/**
 * Schema per risposta getNavConfig (password omessa, sostituita da flag)
 */
export const navConfigResponseSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  hasPassword: z.boolean(),
  company: z.string(),
  syncIntervalMinutes: z.number(),
  readOnly: z.boolean(),
});

// Tipi inferiti dagli schema
export type NavConfigInput = z.infer<typeof navConfigSchema>;
export type NavConfigResponse = z.infer<typeof navConfigResponseSchema>;
