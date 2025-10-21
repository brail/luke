/**
 * Router tRPC per gestione configurazioni
 * Implementa CRUD per AppConfig con supporto per valori cifrati
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logAudit } from '../lib/auditLog';
import {
  saveConfig,
  getConfig,
  // listConfigs,
  listConfigsPaged,
  deleteConfig,
} from '../lib/configManager';
import { withIdempotency } from '../lib/idempotencyTrpc';
import { withRateLimit } from '../lib/ratelimit';
import { router, loggedProcedure, adminProcedure } from '../lib/trpc';
import { withSectionAccess } from '../lib/sectionAccessMiddleware';

/**
 * Chiavi critiche che non possono essere eliminate
 * Queste chiavi sono essenziali per il funzionamento e la sicurezza del sistema
 */
const CRITICAL_KEYS = new Set([
  // Autenticazione e autorizzazione
  'auth.strategy',
  'auth.nextAuthSecret', // Legacy, ancora presente nel seed
  'auth.ldap.url',
  'auth.ldap.searchBase',
  'auth.ldap.searchFilter',

  // Rimuovere chiavi inesistenti (derivate via HKDF, non in DB):
  // 'nextauth.secret', // NON esiste nel DB, derivato via HKDF
  // 'jwt.secret', // NON esiste nel DB, derivato via HKDF
  // 'security.encryption.key', // NON esiste, master key in ~/.luke/secret.key

  // Mail e Storage (on-demand, non critiche per boot)
  // 'mail.smtp', // On-demand, creato dall'admin
  // 'storage.smb', // On-demand, creato dall'admin
  // 'storage.drive', // On-demand, creato dall'admin
]);

/**
 * Prefissi ammessi per le chiavi di configurazione
 */
const ALLOWED_PREFIXES = new Set([
  'app',
  'auth',
  'mail',
  'storage',
  'security',
  'integrations',
]);

/**
 * Genera regex dinamica per validazione formato chiavi
 */
function getKeyRegex(): RegExp {
  const categories = Array.from(ALLOWED_PREFIXES).join('|');
  return new RegExp(`^(${categories})(\\.[a-zA-Z0-9_-]+)+$`);
}

/**
 * Regex per validazione formato chiavi
 */
const KEY_REGEX = getKeyRegex();

/**
 * Verifica se una chiave è critica
 */
function isCriticalKey(key: string): boolean {
  return CRITICAL_KEYS.has(key);
}

/**
 * Valida il formato e il prefisso di una chiave
 */
function validateKey(key: string): void {
  if (!KEY_REGEX.test(key)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Formato chiave non valido. Deve iniziare con una categoria supportata (${Array.from(ALLOWED_PREFIXES).join(', ')})`,
    });
  }

  const prefix = key.split('.')[0];
  if (!ALLOWED_PREFIXES.has(prefix)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Prefisso non ammesso: ${prefix}. Prefissi consentiti: ${Array.from(ALLOWED_PREFIXES).join(', ')}`,
    });
  }
}

/**
 * Redige un valore per l'audit log
 */
function redact(value: string | null, max: number = 32): string | null {
  if (value == null) return null;
  const v = String(value);
  return v.length > max ? v.slice(0, max) + '…' : v;
}

/**
 * Schema per ottenere una configurazione
 */
const GetConfigSchema = z.object({
  key: z.string().min(1, 'Chiave configurazione non può essere vuota'),
  decrypt: z.boolean().optional().default(false),
});

/**
 * Schema per impostare una configurazione
 */
const SetConfigSchema = z.object({
  key: z
    .string()
    .min(1, 'Chiave configurazione non può essere vuota')
    .regex(KEY_REGEX, 'Formato chiave non valido'),
  value: z.string(),
  encrypt: z.boolean().optional().default(false),
  category: z.string().optional(), // override categoria dedotta
});

/**
 * Schema per eliminare una configurazione
 */
const DeleteConfigSchema = z.object({
  key: z.string().min(1, 'Chiave configurazione non può essere vuota'),
});

/**
 * Schema per listare configurazioni con paginazione e filtri
 *
 * @example
 * // Lista base con paginazione
 * { page: 1, pageSize: 20 }
 *
 * @example
 * // Ricerca per chiave con filtri
 * { q: "ldap", category: "auth", isEncrypted: true, sortBy: "updatedAt", sortDir: "desc" }
 */
const ListConfigsSchema = z.object({
  /** Ricerca per chiave (case-insensitive) */
  q: z.string().trim().optional(),
  /** Filtra per categoria dedotta dal prefisso della chiave */
  category: z.string().trim().optional(),
  /** Filtra per tipo di cifratura (true=cifrato, false=plaintext) */
  isEncrypted: z.boolean().optional(),
  /** Campo per ordinamento */
  sortBy: z.enum(['key', 'updatedAt']).default('key'),
  /** Direzione ordinamento */
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  /** Numero pagina (1-based) */
  page: z.number().int().min(1).default(1),
  /** Dimensione pagina (5-100) */
  pageSize: z.number().int().min(5).max(100).default(20),
});

/**
 * Schema per visualizzare valore configurazione con modalità sicura
 *
 * @example
 * // Modalità masked (qualsiasi utente autenticato)
 * { key: "auth.ldap.password", mode: "masked" }
 *
 * @example
 * // Modalità raw (solo admin, genera audit log)
 * { key: "auth.ldap.password", mode: "raw" }
 */
const ViewValueSchema = z.object({
  /** Chiave della configurazione da visualizzare */
  key: z.string().min(1),
  /**
   * Modalità di visualizzazione:
   * - 'masked': valori cifrati mostrano [ENCRYPTED], disponibile per tutti gli utenti autenticati
   * - 'raw': decritta i valori cifrati, richiede ruolo admin e genera audit log obbligatorio
   */
  mode: z.enum(['masked', 'raw']).default('masked'),
});

/**
 * Schema per export JSON sicuro
 *
 * @example
 * // Export solo metadata (senza valori)
 * { includeValues: false }
 *
 * @example
 * // Export con valori (segreti cifrati mostrano [ENCRYPTED])
 * { includeValues: true }
 */
const ExportJsonSchema = z.object({
  /**
   * Se includere i valori nelle configurazioni:
   * - false: solo metadata (chiave, categoria, isEncrypted, updatedAt)
   * - true: include valori, ma i segreti cifrati mostrano sempre [ENCRYPTED] per sicurezza
   */
  includeValues: z.boolean().optional().default(false),
});

/**
 * Schema per import JSON con validazione
 *
 * @example
 * {
 *   "items": [
 *     {"key": "app.name", "value": "Luke", "encrypt": false},
 *     {"key": "auth.ldap.password", "value": "secret", "encrypt": true},
 *     {"key": "auth.ldap.url", "value": null, "encrypt": true} // value: null viene saltato
 *   ]
 * }
 */
const ImportJsonSchema = z.object({
  /** Array di configurazioni da importare */
  items: z.array(
    z.object({
      /** Chiave della configurazione (deve rispettare formato e prefissi ammessi) */
      key: z.string().min(1),
      /** Valore della configurazione (null = salta questo item) */
      value: z.string().nullable(),
      /** Se cifrare il valore (true = cifra, false/null = plaintext) */
      encrypt: z.boolean().optional().nullable(),
    })
  ),
});

/**
 * Router per gestione configurazioni
 */
export const configRouter = router({
  /**
   * Lista configurazioni con paginazione e filtri
   */
  list: loggedProcedure
    .input(ListConfigsSchema)
    .query(async ({ input, ctx }) => {
      return await listConfigsPaged(ctx.prisma, {
        q: input.q,
        category: input.category,
        isEncrypted: input.isEncrypted,
        sortBy: input.sortBy,
        sortDir: input.sortDir,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  /**
   * Ottiene una configurazione specifica
   */
  get: loggedProcedure.input(GetConfigSchema).query(async ({ input, ctx }) => {
    // Se decrypt=true, verifica che l'utente sia admin
    if (input.decrypt && ctx.session?.user?.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Accesso negato: richiesto ruolo admin per decrittare valori',
      });
    }

    const value = await getConfig(ctx.prisma, input.key, input.decrypt);

    if (value === null) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Configurazione '${input.key}' non trovata`,
      });
    }

    // Se non decrittato e il valore è cifrato, mostra placeholder
    const finalValue =
      !input.decrypt && value.includes(':') ? '[ENCRYPTED]' : value;

    return {
      key: input.key,
      value: finalValue,
      isEncrypted: !input.decrypt ? undefined : false,
    };
  }),

  /**
   * Visualizza valore configurazione con modalità masked/raw
   */
  viewValue: loggedProcedure
    .input(ViewValueSchema)
    .query(async ({ input, ctx }) => {
      // Se mode=raw, verifica che l'utente sia admin
      if (input.mode === 'raw' && ctx.session?.user?.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Accesso negato: richiesto ruolo admin per visualizzare valori raw',
        });
      }

      const config = await ctx.prisma.appConfig.findUnique({
        where: { key: input.key },
      });

      if (!config) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Configurazione '${input.key}' non trovata`,
        });
      }

      let value: string;

      if (input.mode === 'masked') {
        // Modalità masked: se cifrato mostra placeholder, altrimenti valore completo
        value = config.isEncrypted ? '[ENCRYPTED]' : config.value;
      } else {
        // Modalità raw: decritta se cifrato, altrimenti valore normale
        if (config.isEncrypted) {
          try {
            const { decryptValue } = await import('../lib/configManager');
            value = decryptValue(config.value);
          } catch (error) {
            ctx.logger.error(
              {
                key: input.key,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              'Errore decifratura config'
            );
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Impossibile decifrare configurazione: ${input.key}`,
            });
          }
        } else {
          value = config.value;
        }

        // Log audit per visualizzazione raw
        await logAudit(ctx, {
          action: 'CONFIG_VIEW_VALUE',
          targetType: 'Config',
          targetId: input.key,
          result: 'SUCCESS',
          metadata: { key: input.key, mode: 'raw' },
        });
      }

      return {
        key: input.key,
        value,
        isEncrypted: config.isEncrypted,
        mode: input.mode,
      };
    }),

  /**
   * Imposta una configurazione
   */
  set: adminProcedure
    .use(withRateLimit('configMutations'))
    .use(withIdempotency())
    .input(SetConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Valida la chiave
      validateKey(input.key);

      // Validazione speciale per password policy (sicurezza)
      if (input.key === 'security.password.minLength') {
        const minLength = parseInt(input.value, 10);
        if (isNaN(minLength) || minLength < 8) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Password minLength non può essere inferiore a 8 caratteri',
          });
        }
        if (minLength > 128) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Password minLength non può essere superiore a 128 caratteri',
          });
        }
      }

      // Verifica se la configurazione esiste già
      // const existingConfig = await ctx.prisma.appConfig.findUnique({
      //   where: { key: input.key },
      // });

      await saveConfig(ctx.prisma, input.key, input.value, input.encrypt);

      // Log audit con azione appropriata
      await logAudit(ctx, {
        action: 'CONFIG_UPSERT',
        targetType: 'Config',
        targetId: input.key,
        result: 'SUCCESS',
        metadata: {
          key: input.key,
          isEncrypted: input.encrypt,
          valueRedacted: input.encrypt ? '[ENCRYPTED]' : redact(input.value),
        },
      });

      return {
        key: input.key,
        value: input.encrypt ? '[CIFRATO]' : input.value,
        isEncrypted: input.encrypt,
        message: `Configurazione '${input.key}' salvata con successo`,
      };
    }),

  /**
   * Elimina una configurazione
   */
  delete: adminProcedure
    .use(withSectionAccess('maintenance'))
    .use(withRateLimit('configMutations'))
    .input(DeleteConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Verifica che la configurazione esista
      const existingConfig = await ctx.prisma.appConfig.findUnique({
        where: { key: input.key },
      });

      if (!existingConfig) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Configurazione '${input.key}' non trovata`,
        });
      }

      // Protezione chiavi critiche
      if (isCriticalKey(input.key)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `La chiave '${input.key}' è critica e non può essere eliminata`,
        });
      }

      await deleteConfig(ctx.prisma, input.key);

      // Log audit
      await logAudit(ctx, {
        action: 'CONFIG_DELETE',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: { key: input.key },
      });

      return {
        key: input.key,
        message: `Configurazione '${input.key}' eliminata con successo`,
      };
    }),

  /**
   * Aggiorna una configurazione esistente
   */
  update: adminProcedure
    .use(withSectionAccess('maintenance'))
    .use(withRateLimit('configMutations'))
    .use(withIdempotency())
    .input(SetConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Valida la chiave
      validateKey(input.key);

      // Validazione speciale per password policy (sicurezza)
      if (input.key === 'security.password.minLength') {
        const minLength = parseInt(input.value, 10);
        if (isNaN(minLength) || minLength < 8) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Password minLength non può essere inferiore a 8 caratteri',
          });
        }
        if (minLength > 128) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Password minLength non può essere superiore a 128 caratteri',
          });
        }
      }

      // Verifica che la configurazione esista
      const existingConfig = await ctx.prisma.appConfig.findUnique({
        where: { key: input.key },
      });

      if (!existingConfig) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Configurazione '${input.key}' non trovata. Usa 'set' per creare una nuova configurazione.`,
        });
      }

      await saveConfig(ctx.prisma, input.key, input.value, input.encrypt);

      // Log audit
      await logAudit(ctx, {
        action: 'CONFIG_UPSERT',
        targetType: 'Config',
        targetId: input.key,
        result: 'SUCCESS',
        metadata: {
          key: input.key,
          isEncrypted: input.encrypt,
          valueRedacted: input.encrypt ? '[ENCRYPTED]' : redact(input.value),
        },
      });

      return {
        key: input.key,
        value: input.encrypt ? '[CIFRATO]' : input.value,
        isEncrypted: input.encrypt,
        message: `Configurazione '${input.key}' aggiornata con successo`,
      };
    }),

  /**
   * Ottiene configurazioni multiple in una singola chiamata
   */
  getMultiple: loggedProcedure
    .input(
      z.object({
        keys: z.array(
          z.string().min(1, 'Chiave configurazione non può essere vuota')
        ),
        decrypt: z.boolean().optional().default(true),
      })
    )
    .query(async ({ input, ctx }) => {
      const results = await Promise.all(
        input.keys.map(async key => {
          try {
            const value = await getConfig(ctx.prisma, key, input.decrypt);
            return {
              key,
              value,
              found: true,
            };
          } catch (error) {
            return {
              key,
              value: null,
              found: false,
              error:
                error instanceof Error ? error.message : 'Errore sconosciuto',
            };
          }
        })
      );

      return results;
    }),

  /**
   * Imposta configurazioni multiple in una singola chiamata
   */
  setMultiple: adminProcedure
    .input(
      z.object({
        configs: z.array(
          z.object({
            key: z
              .string()
              .min(1, 'Chiave configurazione non può essere vuota'),
            value: z.string(),
            encrypt: z.boolean().optional().default(false),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const results = await Promise.all(
        input.configs.map(async config => {
          try {
            // Valida la chiave
            validateKey(config.key);

            // Verifica se la configurazione esiste già
            // const existingConfig = await ctx.prisma.appConfig.findUnique({
            //   where: { key: config.key },
            // });

            await saveConfig(
              ctx.prisma,
              config.key,
              config.value,
              config.encrypt
            );

            // Log audit granulare per ogni configurazione
            await logAudit(ctx, {
              action: 'CONFIG_UPSERT',
              targetType: 'Config',
              targetId: config.key,
              result: 'SUCCESS',
              metadata: {
                key: config.key,
                isEncrypted: config.encrypt,
                valueRedacted: config.encrypt
                  ? '[ENCRYPTED]'
                  : redact(config.value),
              },
            });

            return {
              key: config.key,
              success: true,
              message: `Configurazione '${config.key}' salvata con successo`,
            };
          } catch (error) {
            return {
              key: config.key,
              success: false,
              error:
                error instanceof Error ? error.message : 'Errore sconosciuto',
            };
          }
        })
      );

      return results;
    }),

  /**
   * Verifica se una configurazione esiste
   */
  exists: loggedProcedure
    .input(
      z.object({
        key: z.string().min(1, 'Chiave configurazione non può essere vuota'),
      })
    )
    .query(async ({ input, ctx }) => {
      const config = await ctx.prisma.appConfig.findUnique({
        where: { key: input.key },
        select: { key: true, isEncrypted: true },
      });

      return {
        key: input.key,
        exists: !!config,
        isEncrypted: config?.isEncrypted,
      };
    }),

  /**
   * Esporta configurazioni in formato JSON
   */
  exportJson: adminProcedure
    .input(ExportJsonSchema)
    .mutation(async ({ input, ctx }) => {
      const configs = await ctx.prisma.appConfig.findMany({
        orderBy: { key: 'asc' },
        select: {
          key: true,
          value: true,
          isEncrypted: true,
          updatedAt: true,
        },
      });

      const exportData = configs.map(config => ({
        key: config.key,
        category: config.key.split('.')[0] || 'misc',
        isEncrypted: config.isEncrypted,
        value: input.includeValues
          ? config.isEncrypted
            ? '[ENCRYPTED]' // Mai decrittare segreti nell'export
            : config.value
          : null,
        updatedAt: config.updatedAt.toISOString(),
      }));

      // Log audit aggregato
      await logAudit(ctx, {
        action: 'CONFIG_EXPORT',
        targetType: 'Config',
        result: 'SUCCESS',
        metadata: {
          includeValues: input.includeValues,
          count: configs.length,
        },
      });

      return {
        configs: exportData,
        exportedAt: new Date().toISOString(),
        includeValues: input.includeValues,
        count: configs.length,
      };
    }),

  /**
   * Importa configurazioni da formato JSON
   */
  importJson: adminProcedure
    .input(ImportJsonSchema)
    .mutation(async ({ input, ctx }) => {
      const results = {
        successCount: 0,
        errorCount: 0,
        errors: [] as Array<{ key: string; error: string }>,
      };

      for (const item of input.items) {
        try {
          // Valida la chiave
          validateKey(item.key);

          // Se value è null, salta questo item
          if (item.value === null) {
            continue;
          }

          // Determina se cifrare
          const shouldEncrypt = item.encrypt === true;

          // Verifica se la configurazione esiste già
          // const existingConfig = await ctx.prisma.appConfig.findUnique({
          //   where: { key: item.key },
          // });

          await saveConfig(ctx.prisma, item.key, item.value, shouldEncrypt);

          // Log audit granulare per ogni chiave importata
          await logAudit(ctx, {
            action: 'CONFIG_UPSERT',
            targetType: 'Config',
            targetId: item.key,
            result: 'SUCCESS',
            metadata: {
              key: item.key,
              isEncrypted: shouldEncrypt,
              valueRedacted: shouldEncrypt ? '[ENCRYPTED]' : redact(item.value),
              source: 'import',
            },
          });

          results.successCount++;
        } catch (error) {
          results.errorCount++;
          results.errors.push({
            key: item.key,
            error:
              error instanceof Error ? error.message : 'Errore sconosciuto',
          });
        }
      }

      return results;
    }),
});
