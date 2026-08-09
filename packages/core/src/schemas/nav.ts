/**
 * Zod schemas for Microsoft NAV (SQL Server) integration configuration.
 * Shared between API and frontend; the password is never included in response schemas.
 */

import { z } from 'zod';

/** Input schema for saving NAV SQL Server connection configuration. */
export const navConfigSchema = z.object({
  host: z.string().min(1, 'Host richiesto'),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1, 'Database richiesto'),
  user: z.string().min(1, 'Utente richiesto'),
  password: z.string().optional(),
  company: z.string().min(1, 'Company richiesto'),
  /** Connessione SQL Server in sola lettura (ApplicationIntent=ReadOnly). */
  readOnly: z.boolean(),
  /** Abilita/disabilita globalmente la sincronizzazione NAV (scheduler + sync manuale). */
  syncEnabled: z.boolean(),
});

/**
 * Response shape for `getNavConfig`. The password is omitted and replaced with `hasPassword`.
 */
export const navConfigResponseSchema = z.object({
  host: z.string(),
  port: z.number(),
  database: z.string(),
  user: z.string(),
  hasPassword: z.boolean(),
  company: z.string(),
  readOnly: z.boolean(),
});

// Tipi inferiti dagli schema
export type NavConfigInput = z.infer<typeof navConfigSchema>;
export type NavConfigResponse = z.infer<typeof navConfigResponseSchema>;
