/**
 * LDAP sub-router for integrations
 * Handles LDAP configuration and connection testing
 */

import { TRPCError } from '@trpc/server';
import { Client } from 'ldapts';
import { z } from 'zod';

import { ldapConfigSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { getLdapConfig, encryptValue } from '../lib/configManager';
import { toErrorCode, toErrorMessage } from '../lib/error';
import { SecureLogger } from '../lib/errorHandler';
import { escapeLdapFilter } from '../lib/ldapAuth';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

export const ldapRouter = router({
  /**
   * Saves the global LDAP configuration; all fields are stored under auth.ldap.* in AppConfig (encrypted where sensitive).
   *
   * @auth {config:update}
   * @input {ldapConfigSchema} — url, bindDN, bindPassword, searchBase/Filter, groupSearch*, roleMapping, strategy, enabled.
   * @output {{ success: true, message: string }}
   */
  saveLdapConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(ldapConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const logger = new SecureLogger(ctx.logger);

        // Validate that roleMapping is valid JSON (only if present)
        if (input.roleMapping && input.roleMapping.trim() !== '') {
          try {
            JSON.parse(input.roleMapping);
          } catch {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Role Mapping deve essere un JSON valido',
            });
          }
        }

        // Save each field in AppConfig
        const configMappings = [
          {
            key: 'auth.ldap.enabled',
            value: input.enabled.toString(),
            encrypt: false,
          },
          { key: 'auth.ldap.url', value: input.url, encrypt: true },
          { key: 'auth.ldap.bindDN', value: input.bindDN, encrypt: true },
          {
            key: 'auth.ldap.searchBase',
            value: input.searchBase,
            encrypt: true,
          },
          {
            key: 'auth.ldap.searchFilter',
            value: input.searchFilter,
            encrypt: true,
          },
          {
            key: 'auth.ldap.groupSearchBase',
            value: input.groupSearchBase,
            encrypt: true,
          },
          {
            key: 'auth.ldap.groupSearchFilter',
            value: input.groupSearchFilter,
            encrypt: true,
          },
          {
            key: 'auth.ldap.roleMapping',
            value: input.roleMapping,
            encrypt: true,
          },
          { key: 'auth.strategy', value: input.strategy, encrypt: false },
        ];

        await ctx.prisma.$transaction(async (tx) => {
          for (const mapping of configMappings) {
            if (mapping.value !== undefined) {
              const finalValue = mapping.encrypt ? encryptValue(mapping.value) : mapping.value;
              await tx.appConfig.upsert({
                where: { key: mapping.key },
                update: { value: finalValue, isEncrypted: mapping.encrypt, updatedAt: new Date() },
                create: { key: mapping.key, value: finalValue, isEncrypted: mapping.encrypt },
              });
            }
          }
          if (input.bindPassword != null && input.bindPassword !== '') {
            const encryptedPassword = encryptValue(input.bindPassword);
            await tx.appConfig.upsert({
              where: { key: 'auth.ldap.bindPassword' },
              update: { value: encryptedPassword, isEncrypted: true, updatedAt: new Date() },
              create: { key: 'auth.ldap.bindPassword', value: encryptedPassword, isEncrypted: true },
            });
          }
        });

        logger.info('LDAP configuration saved', {
          enabled: input.enabled,
          url: input.url,
          strategy: input.strategy,
          hasBindPassword: !!input.bindPassword,
        });

        // Aggregated audit log for LDAP
        await logAudit(ctx, {
          action: 'CONFIG_UPSERT',
          targetType: 'AppConfig',
          targetId: 'auth.ldap',
          result: 'SUCCESS',
          metadata: {
            configKeys: [
              'auth.ldap.enabled',
              'auth.ldap.url',
              'auth.ldap.bindDN',
              'auth.ldap.searchBase',
              'auth.ldap.searchFilter',
              'auth.ldap.groupSearchBase',
              'auth.ldap.groupSearchFilter',
              'auth.ldap.roleMapping',
              'auth.strategy',
            ],
            ldapEnabled: input.enabled,
            strategy: input.strategy,
            hasBindPassword: !!input.bindPassword,
          },
        });

        return {
          success: true,
          message: 'Configurazione LDAP salvata con successo',
        };
      } catch (error: unknown) {
        // Log audit FAILURE
        await logAudit(ctx, {
          action: 'CONFIG_UPSERT',
          targetType: 'AppConfig',
          targetId: 'auth.ldap',
          result: 'FAILURE',
          metadata: {
            errorCode: toErrorCode(error),
            errorMessage: toErrorMessage(error).substring(0, 100),
          },
        });

        if (error instanceof TRPCError) {
          throw error;
        }

        ctx.logger.error(
          { error: toErrorMessage(error) },
          'Error saving LDAP config'
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante salvataggio configurazione LDAP',
          cause: error,
        });
      }
    }),

  /**
   * Returns the current global LDAP configuration; sensitive fields (bindDN, password) are omitted.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ enabled, url, hasBindDN, hasBindPassword, searchBase, searchFilter, roleMapping, strategy, ... }}
   */
  getLdapConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      try {
        const config = await getLdapConfig(ctx.prisma);

        // Convert roleMapping object to JSON string for the frontend
        const roleMappingJson = JSON.stringify(config.roleMapping, null, 2);

        // For security, omit sensitive data
        return {
          enabled: config.enabled,
          url: config.url,
          hasBindDN: !!config.bindDN,
          hasBindPassword: !!config.bindPassword,
          searchBase: config.searchBase,
          searchFilter: config.searchFilter,
          groupSearchBase: config.groupSearchBase,
          groupSearchFilter: config.groupSearchFilter,
          roleMapping: roleMappingJson,
          strategy: config.strategy,
        };
      } catch (error: unknown) {
        const message = toErrorMessage(error);
        ctx.logger.error(
          { error: message },
          'Error getting LDAP config'
        );

        // If it's a missing-configuration error, return the default configuration
        if (message.includes('Configurazioni LDAP mancanti')) {
          return {
            enabled: false,
            url: '',
            hasBindDN: false,
            hasBindPassword: false,
            searchBase: '',
            searchFilter: '',
            groupSearchBase: '',
            groupSearchFilter: '',
            roleMapping: '{}',
            strategy: 'local-first' as const,
          };
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante recupero configurazione LDAP',
          cause: error,
        });
      }
    }),

  /**
   * Tests the LDAP connection by binding with the stored credentials.
   *
   * @auth {config:update}
   * @input {none}
   * @output {{ success: true, message: string }}
   */
  testLdapConnection: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('ldapTest'))
    .mutation(async ({ ctx }) => {
      let client: Client | null = null;

      try {
        const config = await getLdapConfig(ctx.prisma);

        if (!config.enabled) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'LDAP non è abilitato',
          });
        }

        if (!config.url || !config.bindDN || !config.bindPassword) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Configurazione LDAP incompleta per il test',
          });
        }

        ctx.logger.info('Testing LDAP connection');

        // Create LDAP client (ldapts: lazy connection on first bind)
        client = new Client({
          url: config.url,
          timeout: 10000,
          connectTimeout: 5000,
        });

        // Test connection and bind
        try {
          await client.bind(config.bindDN, config.bindPassword);
          ctx.logger.info('LDAP connection test successful');
        } catch (err: unknown) {
          ctx.logger.error(
            { error: toErrorMessage(err) },
            'LDAP connection test failed'
          );
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Connessione LDAP fallita. Controllare i log per i dettagli.',
            cause: err,
          });
        }

        return {
          success: true,
          message: 'Connessione LDAP riuscita',
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) {
          throw error;
        }

        ctx.logger.error(
          { error: toErrorMessage(error) },
          'LDAP connection test error'
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante test connessione LDAP',
          cause: error,
        });
      } finally {
        // Close connection
        if (client) {
          try {
            await client.unbind();
          } catch (error) {
            ctx.logger.warn(
              {
                error:
                  error instanceof Error ? error.message : 'Unknown error',
              },
              'Error closing LDAP test connection'
            );
          }
        }
      }
    }),

  /**
   * Tests the LDAP user search using the configured searchFilter with the given username.
   *
   * @auth {config:update}
   * @input {{ username: string }} — username to search for (LDAP-escaped to prevent injection).
   * @output {{ success: true, message: string, results: Array<{ dn, attributes }> }}
   */
  testLdapSearch: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('ldapTest'))
    .input(z.object({ username: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      let client: Client | null = null;

      try {
        const config = await getLdapConfig(ctx.prisma);

        if (!config.enabled) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'LDAP non è abilitato',
          });
        }

        // Create LDAP client (ldapts: lazy connection on first bind)
        client = new Client({
          url: config.url,
          timeout: 10000,
        });

        // Administrative bind
        try {
          await client.bind(config.bindDN, config.bindPassword);
        } catch (err: unknown) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Bind LDAP fallito: ${toErrorMessage(err)}`,
            cause: err,
          });
        }

        // Test user search (input.username escaped against LDAP injection — RFC 4515)
        const searchFilter = config.searchFilter.replace(
          /\$\{username\}/g,
          escapeLdapFilter(input.username)
        );
        ctx.logger.info(
          {
            username: input.username,
            searchBase: config.searchBase,
            searchFilter,
          },
          'Testing LDAP search'
        );

        let searchEntries;
        try {
          const result = await client.search(config.searchBase, {
            filter: searchFilter,
            scope: 'sub',
            attributes: [
              'dn',
              'cn',
              'mail',
              'uid',
              'sAMAccountName',
              'userPrincipalName',
            ],
          });
          searchEntries = result.searchEntries;
        } catch (err: unknown) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Ricerca LDAP fallita: ${toErrorMessage(err)}`,
            cause: err,
          });
        }

        // ldapts returns flat entries: { dn: string; [key]: string | string[] }
        const results = searchEntries.map(entry => {
          const attributes: Record<string, string | string[]> = {};
          for (const key of Object.keys(entry)) {
            if (key === 'dn') continue;
            attributes[key] = entry[key] as string | string[];
          }
          const result = { dn: entry.dn, attributes };
          ctx.logger.info({ dn: entry.dn }, 'LDAP search result found');
          return result;
        });

        return {
          success: true,
          message: `Ricerca completata. Trovati ${results.length} risultati.`,
          results,
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) {
          throw error;
        }

        ctx.logger.error({ error: toErrorMessage(error) }, 'LDAP search test error');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante test ricerca LDAP',
          cause: error,
        });
      } finally {
        if (client) {
          try {
            await client.unbind();
          } catch (error) {
            ctx.logger.error(
              {
                error:
                  error instanceof Error ? error.message : 'Unknown error',
              },
              'Error closing LDAP connection'
            );
          }
        }
      }
    }),
});
