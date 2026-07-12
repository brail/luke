export { getNavDbConfig, sanitizeCompany } from './config.js';
export type { NavDbConfig, GetConfigFn } from './config.js';

export { getPool, closePool, testNavConnection } from './client.js';
export type { NavConnectionStep } from './client.js';

export { runNavSync } from './sync/index.js';
export type { NavSyncReport } from './sync/index.js';

export { createSyncRequest } from './sync/utils.js';

export { syncVendors } from './sync/vendors.js';
export { syncBrands } from './sync/brands.js';
export { syncSeasons } from './sync/seasons.js';
export type { SyncResult } from './sync/vendors.js';

export { queryPortafoglioOrdini } from './statistics/portafoglio.js';
export type { PortafoglioParams, PortafoglioRow } from './statistics/portafoglio.js';

export { queryPortafoglioFromPg } from './queries/portafoglio-pg.js';
export { queryKimoFromPg } from './queries/kimo-pg.js';
export type { KimoParams, KimoRow } from './queries/kimo-pg.js';

export { syncPortafoglioNow } from './sync/portafoglio.js';
export type { PortafoglioSyncResult } from './sync/portafoglio.js';

export { syncKimoNow } from './sync/kimo.js';
export type { KimoSyncResult } from './sync/kimo.js';

export type { TableSyncStats } from './sync/pgUpsert.js';
