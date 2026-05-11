import { z } from 'zod';

import { logAudit } from '../lib/auditLog';
import { saveConfig, getConfig } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import { testGoogleConnection, generateOAuthUrl, exchangeOAuthCode } from '@luke/calendar';

const serviceAccountConfigSchema = z.object({
  authMode: z.literal('service_account'),
  serviceEmail: z.string().email('Email service account non valida'),
  serviceKey: z.string().optional(),
  impersonateEmail: z.string().email('Email non valida').or(z.literal('')).optional(),
  domain: z.string().min(1, 'Workspace domain obbligatorio'),
  calendarSyncEnabled: z.boolean(),
});

const oauthConfigSchema = z.object({
  authMode: z.literal('oauth_user'),
  oauthClientId: z.string().min(1, 'Client ID obbligatorio'),
  oauthClientSecret: z.string().optional(),
  domain: z.string().min(1, 'Workspace domain obbligatorio'),
  calendarSyncEnabled: z.boolean(),
});

const saveConfigSchema = z.discriminatedUnion('authMode', [serviceAccountConfigSchema, oauthConfigSchema]);

export const googleRouter = router({
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
        getConfig(ctx.prisma, 'integrations.google.calendarSync.enabled', false),
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
        calendarSyncEnabled: calendarSyncEnabled === 'true',
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

  saveConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(saveConfigSchema)
    .mutation(async ({ input, ctx }) => {
      await saveConfig(ctx.prisma, 'integrations.google.authMode', input.authMode, false);
      await saveConfig(ctx.prisma, 'integrations.google.domain', input.domain, false);
      await saveConfig(ctx.prisma, 'integrations.google.calendarSync.enabled', String(input.calendarSyncEnabled), false);

      if (input.authMode === 'service_account') {
        await saveConfig(ctx.prisma, 'integrations.google.serviceEmail', input.serviceEmail, false);
        await saveConfig(ctx.prisma, 'integrations.google.impersonateEmail', input.impersonateEmail ?? '', false);
        if (input.serviceKey?.trim()) {
          await saveConfig(ctx.prisma, 'integrations.google.serviceKey', input.serviceKey, true);
        }
      } else {
        await saveConfig(ctx.prisma, 'integrations.google.oauth.clientId', input.oauthClientId, false);
        if (input.oauthClientSecret?.trim()) {
          await saveConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', input.oauthClientSecret, true);
        }
      }

      await logAudit(ctx, {
        action: 'CONFIG_GOOGLE_UPDATE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { authMode: input.authMode, domain: input.domain, calendarSyncEnabled: input.calendarSyncEnabled },
      });

      return { success: true };
    }),

  getOAuthUrl: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ redirectUri: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const [clientId, clientSecret] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', true),
      ]);
      if (!clientId || !clientSecret) {
        throw new Error('Client ID e Client Secret obbligatori prima di avviare OAuth');
      }
      const url = generateOAuthUrl(clientId, clientSecret, input.redirectUri);
      return { url };
    }),

  exchangeOAuthCode: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ code: z.string().min(1), redirectUri: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const [clientId, clientSecret] = await Promise.all([
        getConfig(ctx.prisma, 'integrations.google.oauth.clientId', false),
        getConfig(ctx.prisma, 'integrations.google.oauth.clientSecret', true),
      ]);
      if (!clientId || !clientSecret) {
        throw new Error('Client ID e Client Secret non configurati');
      }
      const { refreshToken, userEmail } = await exchangeOAuthCode(clientId, clientSecret, input.redirectUri, input.code);
      await saveConfig(ctx.prisma, 'integrations.google.oauth.refreshToken', refreshToken, true);
      await saveConfig(ctx.prisma, 'integrations.google.oauth.userEmail', userEmail, false);
      await logAudit(ctx, {
        action: 'CONFIG_GOOGLE_OAUTH_CONNECT',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { userEmail },
      });
      return { userEmail };
    }),

  disconnectOAuth: protectedProcedure
    .use(requirePermission('config:update'))
    .mutation(async ({ ctx }) => {
      await saveConfig(ctx.prisma, 'integrations.google.oauth.refreshToken', '', false);
      await saveConfig(ctx.prisma, 'integrations.google.oauth.userEmail', '', false);
      await logAudit(ctx, {
        action: 'CONFIG_GOOGLE_OAUTH_DISCONNECT',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: {},
      });
      return { success: true };
    }),

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
