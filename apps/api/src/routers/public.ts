/**
 * Router tRPC per endpoint pubblici
 * Accessibile senza autenticazione per informazioni dell'app
 */

import { getConfig } from '../lib/configManager';
import { router, publicProcedure } from '../lib/trpc';

export const publicRouter = router({
  /**
   * Informazioni pubbliche dell'applicazione
   * Accessibile senza autenticazione per login page
   */
  appInfo: publicProcedure.query(async ({ ctx }) => {
    try {
      // Prova a recuperare da database
      const [appName, appVersion] = await Promise.all([
        getConfig(ctx.prisma, 'app.name', false).catch(() => null),
        getConfig(ctx.prisma, 'app.version', false).catch(() => null),
      ]);

      return {
        name: appName || 'Luke',
        version: appVersion || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Fallback completo se database non disponibile
      ctx.logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Fallback to default app info'
      );
      return {
        name: 'Luke',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      };
    }
  }),
});
