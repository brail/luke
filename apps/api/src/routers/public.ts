/**
 * Router tRPC per endpoint pubblici
 * Accessibile senza autenticazione per informazioni dell'app
 */

import { getConfig } from '../lib/configManager';
import { router, publicProcedure } from '../lib/trpc';
import { isDevelopment } from '@luke/core';

export const publicRouter = router({
  /**
   * Informazioni pubbliche dell'applicazione
   * Accessibile senza autenticazione per login page
   */
  appInfo: publicProcedure.query(async ({ ctx }) => {
    try {
      const appName = await getConfig(ctx.prisma, 'app.name', false).catch(() => null);

      return {
        name: appName || 'Luke',
        version: process.env.APP_VERSION ?? 'dev',
        environment: isDevelopment() ? 'development' : 'production',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      ctx.logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Fallback to default app info'
      );
      return {
        name: 'Luke',
        version: process.env.APP_VERSION ?? 'dev',
        environment: isDevelopment() ? 'development' : 'production',
        timestamp: new Date().toISOString(),
      };
    }
  }),
});
