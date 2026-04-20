/**
 * LDAP sub-router per integrazioni
 * Gestisce configurazione e test connessione LDAP
 */

import { TRPCError } from '@trpc/server';
import { Client } from 'ldapts';
import { z } from 'zod';

import { ldapConfigSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { saveConfig, getLdapConfig } from '../lib/configManager';
import { SecureLogger } from '../lib/errorHandler';
import { escapeLdapFilter } from '../lib/ldapAuth';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

export const ldapRouter = router({
  /**
   * Salva la configurazione LDAP globale dell'applicazione
   * IMPORTANTE: La configurazione LDAP è GLOBALE e non legata a utenti specifici.
   * Tutti gli amministratori vedono e modificano la stessa configurazione.
   * Le chiavi sono salvate come 'auth.ldap.*' senza riferimenti a userId.
   */
  saveLdapConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(ldapConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const logger = new SecureLogger(console);

        // Validare che roleMapping sia JSON valido (solo se presente)
        if (input.roleMapping && input.roleMapping.trim() !== '') {
          try {
            JSON.parse(input.roleMapping);
          } catch (error) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Role Mapping deve essere un JSON valido',
            });
          }
        }

        // Salva ogni campo in AppConfig
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

        for (const mapping of configMappings) {
          if (mapping.value !== undefined) {
            await saveConfig(
              ctx.prisma,
              mapping.key,
              mapping.value,
              mapping.encrypt
            );
          }
        }

        // Gestisci bindPassword separatamente solo se presente
        if (input.bindPassword != null && input.bindPassword !== '') {
          await saveConfig(
            ctx.prisma,
            'auth.ldap.bindPassword',
            input.bindPassword,
            true
          );
        }

        logger.info('LDAP configuration saved', {
          enabled: input.enabled,
          url: input.url,
          strategy: input.strategy,
          hasBindPassword: !!input.bindPassword,
        });

        // Log audit aggregato per LDAP
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
      } catch (error: any) {
        // Log audit FAILURE
        await logAudit(ctx, {
          action: 'CONFIG_UPSERT',
          targetType: 'AppConfig',
          targetId: 'auth.ldap',
          result: 'FAILURE',
          metadata: {
            errorCode: error.code || 'UNKNOWN',
            errorMessage: error.message?.substring(0, 100),
          },
        });

        if (error instanceof TRPCError) {
          throw error;
        }

        ctx.logger.error(
          { error: error.message },
          'Error saving LDAP config'
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante salvataggio configurazione LDAP',
        });
      }
    }),

  /**
   * Recupera la configurazione LDAP globale dell'applicazione
   * IMPORTANTE: Restituisce sempre la stessa configurazione per tutti gli amministratori.
   * Non ci sono filtri basati su userId - la configurazione è globale.
   */
  getLdapConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      try {
        const config = await getLdapConfig(ctx.prisma);

        // Converti roleMapping object a JSON string per il frontend
        const roleMappingJson = JSON.stringify(config.roleMapping, null, 2);

        // Per sicurezza, omettere dati sensibili
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
      } catch (error: any) {
        ctx.logger.error(
          { error: error.message },
          'Error getting LDAP config'
        );

        // Se è un errore di configurazioni mancanti, restituisci configurazione di default
        if (error.message.includes('Configurazioni LDAP mancanti')) {
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
        });
      }
    }),

  testLdapConnection: protectedProcedure
    .use(requirePermission('config:read'))
    .use(withRateLimit('configMutations'))
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

        // Crea client LDAP (ldapts: connessione lazy al primo bind)
        client = new Client({
          url: config.url,
          timeout: 10000,
          connectTimeout: 5000,
        });

        // Testa connessione e bind
        try {
          await client.bind(config.bindDN, config.bindPassword);
          ctx.logger.info('LDAP connection test successful');
        } catch (err: any) {
          ctx.logger.error(
            { error: err.message },
            'LDAP connection test failed'
          );
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Connessione LDAP fallita: ${err.message}`,
          });
        }

        return {
          success: true,
          message: 'Connessione LDAP riuscita',
        };
      } catch (error: any) {
        if (error instanceof TRPCError) {
          throw error;
        }

        ctx.logger.error(
          { error: error.message },
          'LDAP connection test error'
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante test connessione LDAP',
        });
      } finally {
        // Chiudi connessione
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

  testLdapSearch: protectedProcedure
    .use(requirePermission('config:read'))
    .input(z.object({ username: z.string() }))
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

        // Crea client LDAP (ldapts: connessione lazy al primo bind)
        client = new Client({
          url: config.url,
          timeout: 10000,
        });

        // Bind amministrativo
        try {
          await client.bind(config.bindDN, config.bindPassword);
        } catch (err: any) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Bind LDAP fallito: ${err.message}`,
          });
        }

        // Testa ricerca utente (input.username escapato contro LDAP injection — RFC 4515)
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
        } catch (err: any) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Ricerca LDAP fallita: ${err.message}`,
          });
        }

        // ldapts restituisce entry flat: { dn: string; [key]: string | string[] }
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
      } catch (error: any) {
        if (error instanceof TRPCError) {
          throw error;
        }

        ctx.logger.error({ error: error.message }, 'LDAP search test error');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante test ricerca LDAP',
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
