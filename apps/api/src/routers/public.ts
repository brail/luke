/**
 * tRPC router for public endpoints
 * Accessible without authentication for app information
 */

import { PASSWORD_SPECIAL_CHARS, isDevelopment } from '@luke/core';

import { getConfig, getPasswordPolicy } from '../lib/configManager';
import { router, publicProcedure } from '../lib/trpc';

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

  /**
   * Returns the configured password policy, so a client can tell the user the rules it will be
   * judged by instead of guessing them.
   *
   * Public on purpose. The reset page lives outside the authenticated layout — a user setting a new
   * password has no session by definition — and it is the page where guessing hurt most: it
   * announced "min 12 characters", showed no complexity requirements at all, and then relayed a
   * server rejection listing rules it had never mentioned.
   *
   * What this discloses is a set of complexity requirements, which any signup or reset form shows
   * its users anyway; it carries no secret and no per-account information.
   *
   * @auth {public}
   * @input {none}
   * @output {{ minLength, requireUppercase, requireLowercase, requireDigit, requireSpecialChar, specialChars }}
   */
  passwordPolicy: publicProcedure.query(async ({ ctx }) => {
    const policy = await getPasswordPolicy(ctx.prisma);
    return {
      ...policy,
      // The exact characters that count, so the UI can name them. Saying "a symbol" is what let
      // `~` and a space look acceptable until the server disagreed.
      specialChars: PASSWORD_SPECIAL_CHARS,
    };
  }),
});
