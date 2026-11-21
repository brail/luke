/**
 * LDAP sub-router for integrations
 * Handles LDAP configuration and connection testing
 */

import { TRPCError } from '@trpc/server';
import { Client, InvalidCredentialsError } from 'ldapts';

import { LDAP_TEST_FIELDS, LdapStrategyInputSchema, ldapConfigSchema, ldapSearchTestSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import {
  ConfigDecryptionError,
  getLdapConfig,
  getLdapConfigForForm,
  unreadableConfigError,
} from '../lib/configManager';
import { externalCheckFailed, toErrorCode, toErrorMessage } from '../lib/error';
import { fillLdapFilter } from '../lib/ldapAuth';
import { ldapClientOptions, trustedCertificateDetails } from '../lib/ldapTls';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { tlsFailureKind, type TlsFailureKind } from '../lib/tlsErrors';
import { router, protectedProcedure } from '../lib/trpc';
import { saveAuthConfig, type AuthConfigWrite } from '../services/authConfig.service';

/** The fixed text of each certificate refusal a settings test can name (#281); any other kind has none. */
const TLS_REFUSED_MESSAGES: Partial<Record<TlsFailureKind, string>> = {
  untrusted:
    'Connessione LDAP fallita: il certificato del server non è attendibile. Incolla in «Certificati attendibili» il certificato del server o della CA che lo ha emesso.',
  hostname:
    "Connessione LDAP fallita: il nome del server nell'URL non corrisponde al certificato. Usa nell'URL il nome riportato nel certificato.",
  validity: 'Connessione LDAP fallita: il certificato del server è scaduto o non ancora valido.',
};

/**
 * The fixed text of a bind that failed in a settings test (#193): refused credentials, a refused
 * certificate (#281, from the TLS error's `code`, which ldapts passes through), or anything else. The
 * caller logs why.
 */
function bindFailedMessage(err: unknown): string {
  if (err instanceof InvalidCredentialsError) return 'Connessione LDAP fallita: credenziali di bind non valide';
  // Only the `code` Node sets on its socket errors is read.
  const kind = tlsFailureKind((err as { code?: unknown } | null)?.code);
  const tlsRefused = kind === null ? undefined : TLS_REFUSED_MESSAGES[kind];
  if (tlsRefused) return tlsRefused;
  return 'Connessione LDAP fallita: verifica URL, raggiungibilità del server, certificato TLS e bind DN';
}

export const ldapRouter = router({
  /**
   * Saves the global LDAP connection settings under auth.ldap.* in AppConfig (encrypted where
   * sensitive). Never the strategy (`saveStrategy`, #246); turning LDAP off under `ldap-only` is refused.
   *
   * @auth {config:update}
   * @input {ldapConfigSchema} — url, bindDN, bindPassword, searchBase/Filter, groupSearch*, roleMapping, trustedCertificates, enabled.
   * @output {{ success: true, message: string }}
   */
  saveLdapConfig: protectedProcedure
    .use(requirePermission('config:update'))
    .input(ldapConfigSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        // Save each field in AppConfig
        const configMappings: { key: AuthConfigWrite['key']; value: string | undefined; encrypt: boolean }[] = [
          {
            key: 'auth.ldap.enabled',
            value: input.enabled.toString(),
            encrypt: false,
          },
          { key: 'auth.ldap.url', value: input.url, encrypt: true },
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
          {
            key: 'auth.ldap.trustedCertificates',
            value: input.trustedCertificates,
            encrypt: true,
          },
        ];

        // The two write-only credentials. `getLdapConfig` answers only whether each is stored, so
        // the form cannot send back what it holds and sends them empty on every save: for these
        // an empty field keeps the stored value, and removing one is `config.delete`. Never
        // trimmed — a password is stored as typed.
        const credentials: typeof configMappings = [
          { key: 'auth.ldap.bindDN', value: input.bindDN, encrypt: true },
          { key: 'auth.ldap.bindPassword', value: input.bindPassword, encrypt: true },
        ];
        // An unreadable field left blank stays as it is, like a blank credential: deleting it would
        // lose what the right master key can still read, and with a role mapping would silently
        // change the role of whoever signs in next.
        const { unreadable } = await getLdapConfigForForm(ctx.prisma);
        const writes = [
          ...configMappings.filter(
            ({ key, value }) => value !== '' || !unreadable.some(field => key === `auth.ldap.${field}`)
          ),
          ...credentials.filter(({ value }) => value),
        ];

        // One change, like every settings form: each value answers to the registry on the plaintext
        // before any is written, and the credentials are encrypted as secrets. An empty optional
        // field is "not configured", which is an absent key, never `''` (the reader already defaults
        // absent ones). Through the strategy's writer: LDAP off under `ldap-only` is refused there.
        await saveAuthConfig(
          ctx.prisma,
          writes.flatMap(({ key, value, encrypt }) =>
            value === undefined ? [] : [value === '' ? { key, value: null } : { key, value, encrypt }]
          )
        );

        ctx.logger.info(
          { enabled: input.enabled, url: input.url, hasBindPassword: !!input.bindPassword },
          'LDAP configuration saved'
        );

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
              'auth.ldap.trustedCertificates',
            ],
            ldapEnabled: input.enabled,
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

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Errore durante salvataggio configurazione LDAP',
          cause: error,
        });
      }
    }),

  /**
   * Saves the sign-in strategy alone (#246): `ldap-only` needs LDAP on and a break-glass administrator,
   * checked under the locks the write holds (`saveAuthConfig`).
   *
   * @auth {config:update}
   * @input {LdapStrategyInputSchema} — strategy.
   * @output {{ success: true, message: string }}
   * @throws {TRPCError} BAD_REQUEST when `ldap-only` would leave no way in.
   */
  saveStrategy: protectedProcedure
    .use(requirePermission('config:update'))
    .input(LdapStrategyInputSchema)
    .mutation(async ({ input, ctx }) => {
      // A refused switch to `ldap-only` is recorded too, as a refused connection save is.
      let failure: unknown;
      await saveAuthConfig(ctx.prisma, [{ key: 'auth.strategy', value: input.strategy }]).catch((error: unknown) => {
        failure = error;
      });
      await logAudit(ctx, {
        action: 'CONFIG_UPSERT',
        targetType: 'Config',
        targetId: 'auth.strategy',
        result: failure === undefined ? 'SUCCESS' : 'FAILURE',
        metadata: { key: 'auth.strategy', strategy: input.strategy, errorCode: failure === undefined ? undefined : toErrorCode(failure) },
      });
      if (failure !== undefined) throw failure;
      return { success: true, message: 'Strategia di autenticazione salvata' };
    }),

  /**
   * Returns the current global LDAP configuration; sensitive fields (bindDN, password) are omitted.
   *
   * @auth {config:read}
   * @input {none}
   * @output {{ enabled, url, hasBindDN, hasBindPassword, searchBase, searchFilter, roleMapping, strategy, unreadable, ... }}
   */
  getLdapConfig: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      try {
        const { config, unreadable, invalidRoleMapping } = await getLdapConfigForForm(ctx.prisma);

        // Convert roleMapping object to JSON string for the frontend; blank when it cannot be read, so
        // that the form does not offer an empty mapping as the stored one. An invalid one goes back as
        // stored, for the admin to correct (#112): the form refuses it until then, so it is never
        // saved again unchanged.
        const roleMappingJson =
          invalidRoleMapping ?? (unreadable.includes('roleMapping') ? '' : JSON.stringify(config.roleMapping, null, 2));

        // None, logged, when the stored certificates do not parse.
        const certificateDetails = config.trustedCertificates ? trustedCertificateDetails(config.trustedCertificates) : [];
        if (certificateDetails === null) {
          ctx.logger.warn({ key: 'auth.ldap.trustedCertificates' }, 'Stored LDAP trusted certificates do not parse');
        }

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
          trustedCertificates: config.trustedCertificates,
          trustedCertificateDetails: certificateDetails ?? [],
          strategy: config.strategy,
          unreadable,
          roleMappingInvalid: invalidRoleMapping !== null,
        };
      } catch (error: unknown) {
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
        const config = await getLdapConfig(ctx.prisma, LDAP_TEST_FIELDS.connection);

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
        client = new Client(ldapClientOptions(config, { timeout: 10000, connectTimeout: 5000 }));

        // Test connection and bind
        try {
          await client.bind(config.bindDN, config.bindPassword);
          ctx.logger.info('LDAP connection test successful');
        } catch (err: unknown) {
          ctx.logger.warn({ err }, 'LDAP connection test: bind failed');
          throw externalCheckFailed(bindFailedMessage(err));
        }

        return {
          success: true,
          message: 'Connessione LDAP riuscita',
        };
      } catch (error: unknown) {
        if (error instanceof TRPCError) {
          throw error;
        }
        if (error instanceof ConfigDecryptionError) {
          throw unreadableConfigError(error);
        }

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
              { err: error },
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
   * @input {ldapSearchTestSchema} — username to search for (LDAP-escaped to prevent injection).
   * @output {{ success: true, message: string, results: Array<{ dn, attributes }> }}
   */
  testLdapSearch: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('ldapTest'))
    .input(ldapSearchTestSchema)
    .mutation(async ({ input, ctx }) => {
      let client: Client | null = null;

      try {
        const config = await getLdapConfig(ctx.prisma, LDAP_TEST_FIELDS.search);

        if (!config.enabled) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'LDAP non è abilitato',
          });
        }

        // Everything the bind and the search below use; without it the attempt fails as a 5xx,
        // whose text production masks.
        if (!config.url || !config.bindDN || !config.bindPassword || !config.searchBase || !config.searchFilter) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Configurazione LDAP incompleta per il test',
          });
        }

        // Create LDAP client (ldapts: lazy connection on first bind)
        client = new Client(ldapClientOptions(config, { timeout: 10000, connectTimeout: 5000 }));

        // Administrative bind
        try {
          await client.bind(config.bindDN, config.bindPassword);
        } catch (err: unknown) {
          ctx.logger.warn({ err }, 'LDAP search test: bind failed');
          throw externalCheckFailed(bindFailedMessage(err));
        }

        // Test user search (input.username escaped against LDAP injection — RFC 4515)
        const searchFilter = fillLdapFilter(config.searchFilter, 'username', input.username);
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
          ctx.logger.warn({ err }, 'LDAP search test: search failed');
          throw externalCheckFailed('Ricerca LDAP fallita: verifica base e filtro di ricerca');
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
        if (error instanceof ConfigDecryptionError) {
          throw unreadableConfigError(error);
        }

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
              { err: error },
              'Error closing LDAP connection'
            );
          }
        }
      }
    }),
});
