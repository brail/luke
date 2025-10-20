/**
 * Integrations Router per Luke API
 * Gestisce configurazioni e test per Storage, Mail e Import/Export
 */

import { TRPCError } from '@trpc/server';
import * as ldap from 'ldapjs';
import * as nodemailer from 'nodemailer';
import { z } from 'zod';

import { ldapConfigSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import {
  saveConfig,
  getConfig,
  getLdapConfig,
  // type LdapConfig,
} from '../lib/configManager';
import {
  ErrorCode,
  createStandardError,
  toTRPCError,
  IntegrationErrorHandler,
  SecureLogger,
} from '../lib/errorHandler';
import { router, publicProcedure, adminProcedure } from '../lib/trpc';

// Schema per configurazione SMB
const smbConfigSchema = z.object({
  host: z.string().min(1, 'Host è obbligatorio'),
  path: z.string().min(1, 'Path è obbligatorio'),
  username: z.string().optional(),
  password: z.string().optional(),
});

// Schema per configurazione Google Drive OAuth
const driveConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID è obbligatorio'),
  clientSecret: z.string().min(1, 'Client Secret è obbligatorio'),
  refreshToken: z.string().min(1, 'Refresh Token è obbligatorio'),
});

// Schema per configurazione SMTP
const smtpConfigSchema = z.object({
  host: z.string().min(1, 'Host SMTP è obbligatorio'),
  port: z.number().min(1).max(65535, 'Porta deve essere tra 1 e 65535'),
  secure: z.boolean().default(false),
  user: z.string().min(1, 'User SMTP è obbligatorio'),
  pass: z.string().optional(), // Opzionale per aggiornamento senza cambiare password
  from: z.string().min(1, 'Email mittente è obbligatoria'),
  baseUrl: z.string().url('Base URL deve essere un URL valido'),
});

// Schema LDAP ora importato da @luke/core

export const integrationsRouter = router({
  // Endpoint di test per verificare che le mutation funzionino
  test: publicProcedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      ctx.logger.info({ input }, 'Test mutation received');
      return {
        success: true,
        message: `Test mutation received: ${input.message}`,
      };
    }),

  storage: router({
    saveConfig: adminProcedure
      .input(
        z.object({
          provider: z.enum(['smb', 'drive']),
          config: z.union([smbConfigSchema, driveConfigSchema]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          ctx.logger.info(
            { provider: input.provider },
            'Storage config save request'
          );
          const { provider, config } = input;
          const configKey = `storage.${provider}`;
          const logger = new SecureLogger(console);

          // Cifra le credenziali sensibili
          let configToSave = { ...config };

          if (provider === 'smb' && 'password' in config && config.password) {
            configToSave = {
              ...configToSave,
              password: '[REDACTED]', // Per i log
            };
          }

          if (
            provider === 'drive' &&
            'clientSecret' in config &&
            config.clientSecret
          ) {
            configToSave = {
              ...configToSave,
              clientSecret: '[REDACTED]', // Per i log
            };
          }

          // Salva la configurazione cifrata
          const configValue = JSON.stringify(config);
          await saveConfig(ctx.prisma, configKey, configValue, true);

          logger.info(`💾 Configurazione storage ${provider} salvata`, {
            provider,
            config: configToSave,
          });

          return {
            success: true,
            message: `Configurazione ${provider.toUpperCase()} salvata con successo`,
          };
        } catch (error: any) {
          const standardError = IntegrationErrorHandler.handleConfigError(
            `storage.${input.provider}`,
            error
          );
          throw toTRPCError(standardError);
        }
      }),

    testConnection: adminProcedure
      .input(
        z.object({
          provider: z.string(),
        })
      )
      .query(async ({ input, ctx }) => {
        const { provider } = input;

        // Per ora restituisce un placeholder
        // In futuro qui si implementerà la logica di test reale
        ctx.logger.info({ provider }, 'Test connessione storage (placeholder)');

        return {
          success: true,
          message: `Connessione ${provider.toUpperCase()} OK (placeholder)`,
        };
      }),
  }),

  mail: router({
    saveConfig: adminProcedure
      .input(smtpConfigSchema)
      .mutation(async ({ input, ctx }) => {
        // Salva ogni campo separatamente in AppConfig
        await saveConfig(ctx.prisma, 'smtp.host', input.host, false);
        await saveConfig(ctx.prisma, 'smtp.port', input.port.toString(), false);
        await saveConfig(
          ctx.prisma,
          'smtp.secure',
          input.secure.toString(),
          false
        );
        await saveConfig(ctx.prisma, 'smtp.user', input.user, false);
        await saveConfig(ctx.prisma, 'smtp.from', input.from, false);
        await saveConfig(ctx.prisma, 'app.baseUrl', input.baseUrl, false);

        // Salva password solo se fornita (cifrata)
        if (input.pass && input.pass.length > 0) {
          await saveConfig(ctx.prisma, 'smtp.pass', input.pass, true);
        }

        ctx.logger.info(
          {
            host: input.host,
            port: input.port,
            secure: input.secure,
            user: input.user,
            from: input.from,
            baseUrl: input.baseUrl,
            passwordUpdated: !!input.pass,
          },
          'Configurazione SMTP salvata'
        );

        // Log audit
        await logAudit(ctx, {
          action: 'CONFIG_SMTP_UPDATE',
          targetType: 'Config',
          result: 'SUCCESS',
          metadata: {
            host: input.host,
            port: input.port,
            secure: input.secure,
            passwordUpdated: !!input.pass,
          },
        });

        return {
          success: true,
          message: 'Configurazione SMTP salvata con successo',
        };
      }),

    test: adminProcedure
      .input(
        z.object({
          testEmail: z.string().email().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const logger = new SecureLogger(console);

          // Recupera la configurazione SMTP dai singoli campi AppConfig
          const [host, port, secure, user, pass, from] = await Promise.all([
            getConfig(ctx.prisma, 'smtp.host', false),
            getConfig(ctx.prisma, 'smtp.port', false),
            getConfig(ctx.prisma, 'smtp.secure', false),
            getConfig(ctx.prisma, 'smtp.user', false),
            getConfig(ctx.prisma, 'smtp.pass', true), // Decifra password
            getConfig(ctx.prisma, 'smtp.from', false),
          ]);

          // Verifica che tutti i campi siano configurati
          if (!host || !port || !user || !pass || !from) {
            const standardError = createStandardError(
              ErrorCode.CONFIG_ERROR,
              'Configurazione SMTP incompleta. Verifica che tutti i campi siano configurati.'
            );
            throw toTRPCError(standardError);
          }

          // Crea transporter nodemailer
          const transporter = nodemailer.createTransport({
            host,
            port: parseInt(port, 10),
            secure: secure === 'true', // true per SSL/TLS, false per STARTTLS
            auth: {
              user,
              pass,
            },
          });

          // Verifica la connessione
          await transporter.verify();

          // Determina il destinatario: parametro o mittente configurato
          const recipient = input.testEmail || from;

          // Invia email di test
          const testEmail = {
            from,
            to: recipient,
            subject: 'Luke - Test Email Configurazione SMTP',
            text: "Questa è un'email di test da Luke. Se ricevi questa email, la configurazione SMTP funziona correttamente!",
            html: "<p>Questa è un'email di test da <strong>Luke</strong>.</p><p>Se ricevi questa email, la configurazione SMTP funziona correttamente! ✅</p>",
          };

          await transporter.sendMail(testEmail);

          logger.info('✅ Email di test inviata con successo', {
            to: recipient,
            subject: testEmail.subject,
          });

          return {
            success: true,
            message: 'Email di test inviata con successo',
            sentTo: recipient,
          };
        } catch (error: any) {
          const standardError = IntegrationErrorHandler.handleSMTPError(error);
          throw toTRPCError(standardError);
        }
      }),
  }),

  importExport: router({
    startImport: adminProcedure
      .input(
        z.object({
          filename: z.string().min(1, 'Nome file è obbligatorio'),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { filename } = input;

        ctx.logger.info({ filename }, 'Import avviato');

        // Placeholder per la logica di import
        // In futuro qui si implementerà l'import reale

        return {
          success: true,
          message: `Import avviato per file: ${filename} (placeholder)`,
        };
      }),

    startExport: adminProcedure
      .input(
        z.object({
          type: z.string().min(1, 'Tipo export è obbligatorio'),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const { type } = input;

        ctx.logger.info({ type }, 'Export avviato');

        // Placeholder per la logica di export
        // In futuro qui si implementerà l'export reale
        const placeholderUrl = `/api/export/${type}-${Date.now()}.json`;

        return {
          success: true,
          message: `Export avviato per tipo: ${type}`,
          url: placeholderUrl,
        };
      }),
  }),

  auth: router({
    /**
     * Salva la configurazione LDAP globale dell'applicazione
     * IMPORTANTE: La configurazione LDAP è GLOBALE e non legata a utenti specifici.
     * Tutti gli amministratori vedono e modificano la stessa configurazione.
     * Le chiavi sono salvate come 'auth.ldap.*' senza riferimenti a userId.
     */
    saveLdapConfig: adminProcedure
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
    getLdapConfig: adminProcedure.query(async ({ ctx }) => {
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
        ctx.logger.error({ error: error.message }, 'Error getting LDAP config');

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

    testLdapConnection: adminProcedure.mutation(async ({ ctx }) => {
      let client: ldap.Client | null = null;

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

        // Crea client LDAP
        client = ldap.createClient({
          url: config.url,
          timeout: 10000,
          connectTimeout: 5000,
        });

        // Gestisci errori non catturati del client
        client.on('error', err => {
          ctx.logger.error({ error: err.message }, 'LDAP client error');
        });

        // Testa connessione e bind
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(
              new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Timeout connessione LDAP (10 secondi)',
              })
            );
          }, 10000);

          client!.bind(config.bindDN, config.bindPassword, err => {
            clearTimeout(timeout);
            if (err) {
              ctx.logger.error(
                { error: err.message },
                'LDAP connection test failed'
              );
              reject(
                new TRPCError({
                  code: 'INTERNAL_SERVER_ERROR',
                  message: `Connessione LDAP fallita: ${err.message}`,
                })
              );
            } else {
              ctx.logger.info('LDAP connection test successful');
              resolve();
            }
          });
        });

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
            await new Promise<void>(resolve => {
              client!.unbind(err => {
                if (err) {
                  ctx.logger.warn(
                    { error: err.message },
                    'Error closing LDAP test connection'
                  );
                }
                resolve();
              });
            });
          } catch (error) {
            ctx.logger.warn(
              {
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              'Error closing LDAP test connection'
            );
          }
        }
      }
    }),

    testLdapSearch: adminProcedure
      .input(z.object({ username: z.string() }))
      .mutation(async ({ input, ctx }) => {
        let client: ldap.Client | null = null;

        try {
          const config = await getLdapConfig(ctx.prisma);

          if (!config.enabled) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'LDAP non è abilitato',
            });
          }

          // Crea client LDAP
          client = ldap.createClient({
            url: config.url,
            timeout: 10000,
          });

          // Bind amministrativo
          await new Promise<void>((resolve, reject) => {
            client!.bind(config.bindDN, config.bindPassword, err => {
              if (err) {
                reject(
                  new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: `Bind LDAP fallito: ${err.message}`,
                  })
                );
              } else {
                resolve();
              }
            });
          });

          // Testa ricerca utente
          const searchFilter = config.searchFilter.replace(
            /\$\{username\}/g,
            input.username
          );
          ctx.logger.info(
            {
              username: input.username,
              searchBase: config.searchBase,
              searchFilter,
            },
            'Testing LDAP search'
          );

          const results: any[] = [];

          await new Promise<void>((resolve, reject) => {
            client!.search(
              config.searchBase,
              {
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
              },
              (err, res) => {
                if (err) {
                  reject(
                    new TRPCError({
                      code: 'INTERNAL_SERVER_ERROR',
                      message: `Ricerca LDAP fallita: ${err.message}`,
                    })
                  );
                  return;
                }

                res.on('searchEntry', entry => {
                  const result = {
                    dn: entry.dn.toString(),
                    attributes: entry.attributes.reduce(
                      (acc: any, attr: any) => {
                        acc[attr.type] = attr.values;
                        return acc;
                      },
                      {}
                    ),
                  };
                  results.push(result);
                  ctx.logger.info(
                    { dn: result.dn },
                    'LDAP search result found'
                  );
                });

                res.on('error', err => {
                  reject(
                    new TRPCError({
                      code: 'INTERNAL_SERVER_ERROR',
                      message: `Errore stream ricerca: ${err.message}`,
                    })
                  );
                });

                res.on('end', () => {
                  resolve();
                });
              }
            );
          });

          return {
            success: true,
            message: `Ricerca completata. Trovati ${results.length} risultati.`,
            results,
            searchConfig: {
              base: config.searchBase,
              filter: searchFilter,
              username: input.username,
            },
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
              await new Promise<void>(resolve => {
                client!.unbind(() => {
                  resolve();
                });
              });
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
  }),
});
