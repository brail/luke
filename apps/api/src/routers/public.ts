/**
 * Router tRPC per endpoint pubblici
 * Accessibile senza autenticazione per informazioni dell'app
 */

import { getConfig } from '../lib/configManager';
import { router, publicProcedure } from '../lib/trpc';
import { isDevelopment } from '@luke/core';

export const publicRouter = router({
  /**
   * Returns public application metadata (name, version, environment) for the login page and unauthenticated clients.
   *
   * @auth {public}
   * @input {none}
   * @output {{ name: string, version: string, environment: string, timestamp: string }}
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
