/**
 * Router tRPC per gestione configurazioni
 * Implementa CRUD per AppConfig con supporto per valori cifrati
 */

import { z } from 'zod';
import { router, loggedProcedure, adminProcedure } from '../lib/trpc';
import { TRPCError } from '@trpc/server';
import {
  saveConfig,
  getConfig,
  listConfigs,
  listConfigsPaged,
  deleteConfig,
} from '../lib/configManager';
import { logAudit } from '../lib/auditLog';

/**
 * Chiavi critiche che non possono essere eliminate
 */
const CRITICAL_KEYS = new Set([
  'auth.strategy',
  'auth.ldap.url',
  'auth.ldap.searchBase',
  'auth.ldap.searchFilter',
  'mail.smtp',
  'storage.smb',
  'storage.drive',
  'nextauth.secret',
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
 * Schema per listare configurazioni
 */
const ListConfigsSchema = z.object({
  q: z.string().trim().optional(), // ricerca per chiave (case-insensitive)
  category: z.string().trim().optional(), // filtra per categoria dedotta
  isEncrypted: z.boolean().optional(), // filtra cifrato/plain
  sortBy: z.enum(['key', 'updatedAt']).default('key'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(20),
});

/**
 * Schema per visualizzare valore configurazione
 */
const ViewValueSchema = z.object({
  key: z.string().min(1),
  mode: z.enum(['masked', 'raw']).default('masked'),
});

/**
 * Schema per export JSON
 */
const ExportJsonSchema = z.object({
  includeValues: z.boolean().optional().default(false),
});

/**
 * Schema per import JSON
 */
const ImportJsonSchema = z.object({
  items: z.array(
    z.object({
      key: z.string().min(1),
      value: z.string().nullable(),
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
            console.error(`Errore decifratura config ${input.key}:`, error);
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
          resource: 'config',
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
    .input(SetConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Valida la chiave
      validateKey(input.key);

      // Verifica se la configurazione esiste già
      const existingConfig = await ctx.prisma.appConfig.findUnique({
        where: { key: input.key },
      });

      await saveConfig(ctx.prisma, input.key, input.value, input.encrypt);

      // Log audit con azione appropriata
      await logAudit(ctx, {
        action: existingConfig ? 'CONFIG_UPDATE' : 'CONFIG_CREATE',
        resource: 'config',
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
        resource: 'config',
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
    .input(SetConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Valida la chiave
      validateKey(input.key);

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
        action: 'CONFIG_UPDATE',
        resource: 'config',
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
            const existingConfig = await ctx.prisma.appConfig.findUnique({
              where: { key: config.key },
            });

            await saveConfig(
              ctx.prisma,
              config.key,
              config.value,
              config.encrypt
            );

            // Log audit granulare per ogni configurazione
            await logAudit(ctx, {
              action: existingConfig ? 'CONFIG_UPDATE' : 'CONFIG_CREATE',
              resource: 'config',
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
        resource: 'config',
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
          const existingConfig = await ctx.prisma.appConfig.findUnique({
            where: { key: item.key },
          });

          await saveConfig(ctx.prisma, item.key, item.value, shouldEncrypt);

          // Log audit granulare per ogni chiave importata
          await logAudit(ctx, {
            action: existingConfig ? 'CONFIG_UPDATE' : 'CONFIG_CREATE',
            resource: 'config',
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
