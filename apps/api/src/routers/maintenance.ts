/**
 * Router tRPC per sezione Maintenance
 */

import { router } from '../lib/trpc';

import { backupRouter } from './maintenance.backup.router';
import { maintenanceModeRouter } from './maintenance.mode.router';

export const maintenanceRouter = router({
  backup: backupRouter,
  mode: maintenanceModeRouter,
});
