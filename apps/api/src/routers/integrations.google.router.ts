import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { testGoogleConnection, generateOAuthUrl, exchangeOAuthCode, MissingRefreshTokenError } from '@luke/calendar';
import { googleWorkspaceConfigSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getConfig, getConfigOrDefault, saveConfigs } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

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
        serviceKey,
        impersonateEmail,
        // oauth
        oauthClientId,
        oauthClientSecret,
        oauthRefreshToken,
        oauthUserEmail,
      ] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.authMode', false),
        getConfig(ctx.prisma, 'integrations.google.domain', false),
        getConfigOrDefault(ctx.prisma, 'integrations.google.calendarSync.enabled'),
        getConfig(ctx.prisma, 'integrations.google.serviceEmail', false),
        getConfig(ctx.prisma, 'integrations.google.serviceKey', false),
        getConfig(ctx.prisma, 'integrations.google.impersonateEmail', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.refreshToken', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.userEmail', false),
      ]);

      return {
        authMode: (authMode ?? 'service_account') as 'service_account' | 'oauth_user',
        domain: domain ?? '',
        calendarSyncEnabled,
        // service account
        serviceEmail: serviceEmail ?? '',
        hasServiceKey: !!serviceKey,
        impersonateEmail: impersonateEmail ?? '',
        // oauth
        oauthClientId: oauthClientId ?? '',
        hasOauthClientSecret: !!oauthClientSecret,
        hasOauthToken: !!oauthRefreshToken,
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
          // spelling of the same state that the registry schema (`z.string().email()`) cannot describe.
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
   * Generates the Google OAuth2 authorization URL for the user to grant access.
   *
   * @auth {config:update}
   * @input {{ redirectUri: string }} — OAuth redirect URI.
   * @output {{ url: string }}
   */
  getOAuthUrl: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ redirectUri: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const [clientId, clientSecret] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', true),
      ]);
      if (!clientId || !clientSecret) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Client ID e Client Secret obbligatori prima di avviare OAuth',
        });
      }
      const url = generateOAuthUrl(clientId, clientSecret, input.redirectUri);
      return { url };
    }),

  /**
   * Exchanges the OAuth authorization code for a refresh token and stores it encrypted.
   *
   * @auth {config:update}
   * @input {{ code: string, redirectUri: string }}
   * @output {{ userEmail: string | null }}
   */
  exchangeOAuthCode: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ code: z.string().min(1), redirectUri: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const [clientId, clientSecret] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', true),
      ]);
      if (!clientId || !clientSecret) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Client ID e Client Secret non configurati' });
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
      const authMode = await getConfig(ctx.prisma, 'integrations.google.authMode', false);
      const domain = await getConfig(ctx.prisma, 'integrations.google.domain', false);
      if (!domain) return { ok: false as const, error: 'Workspace domain non configurato' };

      let result: { ok: true } | { ok: false; error: string };

      if (authMode === 'oauth_user') {
        const [clientId, clientSecret, refreshToken] = await Promise.all([
          getConfig(ctx.prisma, 'integrations.google.oauth.clientId', false),
          getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', true),
          getConfig(ctx.prisma, 'integrations.google.oauth.refreshToken', true),
        ]);
        if (!clientId || !clientSecret || !refreshToken) {
          return { ok: false as const, error: 'Account OAuth non connesso' };
        }
        result = await testGoogleConnection({ mode: 'oauth_user', clientId, clientSecret, refreshToken, workspaceDomain: domain });
      } else {
        const [serviceEmail, serviceKey, impersonateEmail] = await Promise.all([
          getConfig(ctx.prisma, 'integrations.google.serviceEmail', false),
          getConfig(ctx.prisma, 'integrations.google.serviceKey', true),
          getConfig(ctx.prisma, 'integrations.google.impersonateEmail', false),
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
