/**
 * tRPC router for the few endpoints that need no session. None of them tells a caller anything about
 * the application itself — name, version, environment (#57).
 */

import { PASSWORD_SPECIAL_CHARS } from '@luke/core';

import { getPasswordPolicy } from '../lib/configManager';
import { router, publicProcedure } from '../lib/trpc';

export const publicRouter = router({
  /**
   * Answers that the API is reachable, and nothing else: the test probes that reach the API through
   * the web origin, where a deployed stack exposes no health route, call it.
   *
   * @auth {public}
   * @input {none}
   * @output {{ ok: true }}
   */
  ping: publicProcedure.query(() => ({ ok: true as const })),

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
