/**
 * Zod schemas for Microsoft NAV (SQL Server) integration configuration.
 * Shared between API and frontend; the password is never included in response schemas.
 */

import { z } from 'zod';

import { PortSchema } from './number.js';

/** Input schema for saving NAV SQL Server connection configuration. */
export const navConfigSchema = z.object({
  host: z.string().min(1, 'Host richiesto'),
  port: PortSchema,
  database: z.string().min(1, 'Database richiesto'),
  user: z.string().min(1, 'Utente richiesto'),
  password: z.string().optional(),
  company: z.string().min(1, 'Company richiesto'),
  /** Read-only SQL Server connection (ApplicationIntent=ReadOnly). */
  readOnly: z.boolean(),
  /** Enables/disables NAV sync globally (scheduler + manual sync). */
  syncEnabled: z.boolean(),
});

// Types inferred from the schemas
export type NavConfigInput = z.infer<typeof navConfigSchema>;
