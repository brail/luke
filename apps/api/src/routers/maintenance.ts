/**
 * Router tRPC per sezione Maintenance
 * Placeholder per funzionalità di manutenzione e diagnostica
 */

import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

export const maintenanceRouter = router({
  /**
   * Returns the current system status (placeholder; always returns operational).
   *
   * @auth {maintenance:read}
   * @input {none}
   * @output {{ status: "operational", timestamp: string, placeholder: true }}
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
