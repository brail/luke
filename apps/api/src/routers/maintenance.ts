/**
 * Router tRPC per sezione Maintenance
 * Placeholder per funzionalità di manutenzione e diagnostica
 */

import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';

export const maintenanceRouter = router({
  /**
   * Ottiene lo stato del sistema
   */
  getStatus: protectedProcedure
    .use(requirePermission('maintenance:read'))
    .query(async () => {
      return {
        status: 'operational',
        timestamp: new Date().toISOString(),
        placeholder: true,
      };
    }),
});
