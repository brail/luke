import { randomBytes, timingSafeEqual } from 'crypto';

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { testGoogleConnection, generateOAuthUrl, exchangeOAuthCode, MissingRefreshTokenError } from '@luke/calendar';
import { googleWorkspaceConfigSchema, httpUrl } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfig, getConfigOrDefault, hasConfig, saveConfigs } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The pending OAuth flow of each user: the `state` its authorization URL carries. A code is
 * exchanged only with it, so a code from a flow somebody else started — a link that lands an admin
 * on the settings page with an attacker's code — binds nothing (#143). A new URL replaces the
 * pending flow.
 */
// ponytail: per-process store, fine for the single API instance (ADR-011); a shared store if the
// API ever scales out. A restart in the middle of a flow only means connecting again.
const pendingOAuthStates = new Map<string, { state: string; expiresAt: number }>();

/**
 * Whether `state` is the user's pending one; a match consumes it. Synchronous from the read to the
 * delete, so two concurrent exchanges of one state cannot both pass. A mismatch leaves the pending
 * flow in place: a stale tab must not end the current one.
 */
function consumeOAuthState(userId: string, state: string): boolean {
  const pending = pendingOAuthStates.get(userId);
  if (!pending) return false;
  if (pending.expiresAt <= Date.now()) {
    pendingOAuthStates.delete(userId);
    return false;
  }
  const expected = Buffer.from(pending.state);
  const received = Buffer.from(state);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  pendingOAuthStates.delete(userId);
  return true;
}

export const googleRouter = router({
  /**
   * Returns the current Google Workspace integration configuration (secrets masked).
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ authMode, domain, calendarSyncEnabled, serviceEmail, hasServiceKey, oauthClientId, hasOauthToken, ... }}
   */
  getConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      const [
        authMode,
        domain,
        calendarSyncEnabled,
        // service account
        serviceEmail,
        hasServiceKey,
        impersonateEmail,
        // oauth
        oauthClientId,
        hasOauthClientSecret,
        hasOauthToken,
        oauthUserEmail,
      ] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.authMode'),
        getConfig(ctx.prisma, 'integrations.google.domain'),
        getConfigOrDefault(ctx.prisma, 'integrations.google.calendarSync.enabled'),
        getConfig(ctx.prisma, 'integrations.google.serviceEmail'),
        // The three credentials are write-only: the page learns whether each is stored, not its value.
        hasConfig(ctx.prisma, 'integrations.google.serviceKey'),
        getConfig(ctx.prisma, 'integrations.google.impersonateEmail'),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId'),
        hasConfig(ctx.prisma, 'integrations.google.oauth.clientSecret'),
        hasConfig(ctx.prisma, 'integrations.google.oauth.refreshToken'),
        getConfig(ctx.prisma, 'integrations.google.oauth.userEmail'),
      ]);

      return {
        authMode: (authMode ?? 'service_account') as 'service_account' | 'oauth_user',
        domain: domain ?? '',
        calendarSyncEnabled,
        // service account
        serviceEmail: serviceEmail ?? '',
        hasServiceKey,
        impersonateEmail: impersonateEmail ?? '',
        // oauth
        oauthClientId: oauthClientId ?? '',
        hasOauthClientSecret,
        hasOauthToken,
        oauthUserEmail: oauthUserEmail ?? '',
      };
    }),

  /**
   * Saves the Google Workspace integration configuration (service account or OAuth mode).
   *
   * @auth {config:update}
   * @input {googleWorkspaceConfigSchema} — discriminated union on authMode: service_account or oauth_user fields.
   * @output {{ success: true }}
   */
  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(googleWorkspaceConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // One change: a failure leaves the stored Google settings as they were. A blank secret keeps
      // the stored one.
      const common = [
        { key: 'integrations.google.authMode' as const, value: input.authMode },
        { key: 'integrations.google.domain' as const, value: input.domain },
        { key: 'integrations.google.calendarSync.enabled' as const, value: String(input.calendarSyncEnabled) },
      ];
      if (input.authMode === 'service_account') {
        await saveConfigs(ctx.prisma, [
          ...common,
          { key: 'integrations.google.serviceEmail', value: input.serviceEmail },
          // An empty field means "no impersonation", which is the absence of the key, not an empty
          // email stored under it: `getConfig` already returns `null` for an absent key and every
          // reader of this one collapses both to `undefined`. Writing `''` would have been a second
          // spelling of the same state that the registry schema (`z.email()`) cannot describe.
          { key: 'integrations.google.impersonateEmail', value: input.impersonateEmail || null },
          ...(input.serviceKey?.trim()
            ? [{ key: 'integrations.google.serviceKey' as const, value: input.serviceKey, encrypt: true }]
            : []),
        ]);
      } else {
        await saveConfigs(ctx.prisma, [
          ...common,
          { key: 'integrations.google.oauth.clientId', value: input.oauthClientId },
          ...(input.oauthClientSecret?.trim()
            ? [{ key: 'integrations.google.oauth.clientSecret' as const, value: input.oauthClientSecret, encrypt: true }]
            : []),
        ]);
      }

      await logAudit(ctx, {
        action: 'CONFIG_GOOGLE_UPDATE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { authMode: input.authMode, domain: input.domain, calendarSyncEnabled: input.calendarSyncEnabled },
      });

      return { success: true };
    }),

  /**
   * Generates the Google OAuth2 authorization URL for the user to grant access, starting the user's
   * pending flow: the URL carries a new `state`, valid ten minutes, that the code exchange requires.
   *
   * @auth {config:update}
   * @input {{ redirectUri: string }} — OAuth redirect URI.
   * @output {{ url: string }}
   */
  getOAuthUrl: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ redirectUri: httpUrl() }))
    .mutation(async ({ input, ctx }) => {
      const [clientId, clientSecret] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId'),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret'),
      ]);
      if (!clientId || !clientSecret) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Client ID e Client Secret obbligatori prima di avviare OAuth',
        });
      }
      const state = randomBytes(32).toString('base64url');
      pendingOAuthStates.set(ctx.session.user.id, { state, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
      const url = generateOAuthUrl(clientId, clientSecret, input.redirectUri, state);
      return { url };
    }),

  /**
   * Exchanges the OAuth authorization code for a refresh token and stores it encrypted — only with the
   * `state` of the flow the same user started through `getOAuthUrl`, checked before any call to Google.
   *
   * @auth {config:update}
   * @input {{ code: string, state: string, redirectUri: string }}
   * @output {{ userEmail: string | null }}
   */
  exchangeOAuthCode: protectedProcedure
    .use(requirePermission('config:update'))
    // Rule 12: it checks a `state`, so an IP bucket and an account bucket, both before the check.
    .use(withRateLimit('googleOAuthExchange'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ code: z.string().min(1), state: z.string().min(1).max(128), redirectUri: httpUrl() }))
    .mutation(async ({ input, ctx }) => {
      const [clientId, clientSecret] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId'),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret'),
      ]);
      if (!clientId || !clientSecret) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Client ID e Client Secret non configurati' });
      }
      if (!consumeOAuthState(ctx.session.user.id, input.state)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Autorizzazione scaduta o non valida: ricollega l'account" });
      }
      let exchanged: Awaited<ReturnType<typeof exchangeOAuthCode>>;
      try {
        exchanged = await exchangeOAuthCode(clientId, clientSecret, input.redirectUri, input.code);
      } catch (err) {
        if (err instanceof MissingRefreshTokenError) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Google non ha restituito un refresh token: ricollega l\'account concedendo di nuovo il consenso',
            cause: err,
          });
        }
        throw err;
      }
      const { refreshToken, userEmail } = exchanged;
      // Token and address change together. No address in Google's answer is no stored address,
      // not an empty one: the registry refuses `''`, and that refusal used to come after the new
      // token was stored, skipping the audit and leaving the previous account's address on show.
      await saveConfigs(ctx.prisma, [
        { key: 'integrations.google.oauth.refreshToken', value: refreshToken, encrypt: true },
        { key: 'integrations.google.oauth.userEmail', value: userEmail || null },
      ]);
      await logAudit(ctx, {
        action: 'CONFIG_GOOGLE_OAUTH_CONNECT',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { userEmail },
      });
      return { userEmail };
    }),

  /**
   * Disconnects the Google OAuth account by clearing the stored refresh token and user email.
   *
   * @auth {config:update}
   * @input {none}
   * @output {{ success: true }}
   */
  disconnectOAuth: protectedProcedure
    .use(requirePermission('config:update'))
    .mutation(async ({ ctx }) => {
      // Disconnecting removes the keys rather than blanking them — see the impersonation note above.
      await saveConfigs(ctx.prisma, [
        { key: 'integrations.google.oauth.refreshToken', value: null },
        { key: 'integrations.google.oauth.userEmail', value: null },
      ]);
      await logAudit(ctx, {
        action: 'CONFIG_GOOGLE_OAUTH_DISCONNECT',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: {
          configKeys: [
            'integrations.google.oauth.refreshToken',
            'integrations.google.oauth.userEmail',
          ],
        },
      });
      return { success: true };
    }),

  /**
   * Tests the configured Google Workspace connection using the stored credentials.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ ok: true } | { ok: false, error: string }}
   */
  testConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .mutation(async ({ ctx }) => {
      const authMode = await getConfig(ctx.prisma, 'integrations.google.authMode');
      const domain = await getConfig(ctx.prisma, 'integrations.google.domain');
      if (!domain) return { ok: false as const, error: 'Workspace domain non configurato' };

      let result: { ok: true } | { ok: false; error: string };

      if (authMode === 'oauth_user') {
        const [clientId, clientSecret, refreshToken] = await Promise.all([
          getConfig(ctx.prisma, 'integrations.google.oauth.clientId'),
          getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret'),
          getConfig(ctx.prisma, 'integrations.google.oauth.refreshToken'),
        ]);
        if (!clientId || !clientSecret || !refreshToken) {
          return { ok: false as const, error: 'Account OAuth non connesso' };
        }
        result = await testGoogleConnection({ mode: 'oauth_user', clientId, clientSecret, refreshToken, workspaceDomain: domain });
      } else {
        const [serviceEmail, serviceKey, impersonateEmail] = await Promise.all([
          getConfig(ctx.prisma, 'integrations.google.serviceEmail'),
          getConfig(ctx.prisma, 'integrations.google.serviceKey'),
          getConfig(ctx.prisma, 'integrations.google.impersonateEmail'),
        ]);
        if (!serviceEmail || !serviceKey) {
          return { ok: false as const, error: 'Credenziali service account non configurate' };
        }
        result = await testGoogleConnection({
          mode: 'service_account',
          serviceAccountEmail: serviceEmail,
          serviceAccountPrivateKey: serviceKey,
          workspaceDomain: domain,
          impersonateEmail: impersonateEmail || undefined,
        });
      }

      if (!result.ok) {
        ctx.logger.warn({ error: result.error }, 'Google Workspace test connection failed');
      }
      return result;
    }),
});
