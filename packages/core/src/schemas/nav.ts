/**
 * Zod schemas for Microsoft NAV (SQL Server) integration configuration.
 * Shared between API and frontend; the password is never included in response schemas.
 */

import { z } from 'zod';

import { intInRange, PortSchema } from './number.js';

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

/** The NAV master-data entities a sync filter selects records of: the three tabs of the sync page. */
export const NAV_MASTER_DATA_ENTITIES = ['vendor', 'brand', 'season'] as const;

/** Every NAV sync filter entity: the master data and the two sales replicas (`NavSyncFilter.entity`). */
export const NAV_SYNC_ENTITIES = [...NAV_MASTER_DATA_ENTITIES, 'portafoglio', 'kimo'] as const;

/**
 * The interval a filter's automatic sync runs at before one is saved (the replicas' tables refresh
 * more often than master data). Prisma's `@default(30)` on `NavSyncFilter.intervalMinutes` cannot
 * import it; it applies only to rows created without an interval.
 */
export const NAV_SYNC_DEFAULT_INTERVAL_MINUTES = {
  vendor: 30,
  brand: 30,
  season: 30,
  portafoglio: 5,
  kimo: 30,
} as const satisfies Record<(typeof NAV_SYNC_ENTITIES)[number], number>;

/** What `integrations.nav.sync.saveSyncSchedule` accepts: the settings page checks the interval with it. */
export const NavSyncScheduleInputSchema = z.object({
  entity: z.enum(NAV_SYNC_ENTITIES),
  autoSyncEnabled: z.boolean(),
  intervalMinutes: intInRange(1, 1440, 'Inserisci un numero intero di minuti tra 1 e 1440'),
});

// Types inferred from the schemas
export type NavConfigInput = z.infer<typeof navConfigSchema>;
export type NavMasterDataEntity = (typeof NAV_MASTER_DATA_ENTITIES)[number];
export type NavSyncEntity = (typeof NAV_SYNC_ENTITIES)[number];
