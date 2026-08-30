/**
 * tRPC router for configuration management
 * Implements CRUD for AppConfig with support for encrypted values
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
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import {
  router,
  protectedProcedure,
  type Context,
} from '../lib/trpc';

/**
 * Critical keys that cannot be deleted
 * These keys are essential to the system's operation and security
 */
const CRITICAL_KEYS = new Set([
  // Authentication and authorization
  'auth.strategy',
  'auth.nextAuthSecret', // Legacy, still present in the seed
  'auth.ldap.url',
  'auth.ldap.searchBase',
  'auth.ldap.searchFilter',

  // Remove non-existent keys (derived via HKDF, not in DB):
  // 'nextauth.secret', // NON esiste nel DB, derivato via HKDF
  // 'jwt.secret', // NON esiste nel DB, derivato via HKDF
  // 'security.encryption.key', // NON esiste, master key in ~/.luke/secret.key

  // Mail and Storage (on-demand, not critical for boot)
  // 'mail.smtp', // On-demand, creato dall'admin
  // 'storage.smb', // On-demand, creato dall'admin
  // 'storage.drive', // On-demand, creato dall'admin
]);

/**
 * Allowed prefixes for configuration keys
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
 * Generates a dynamic regex for validating key format
 */
function getKeyRegex(): RegExp {
  const categories = Array.from(ALLOWED_PREFIXES).join('|');
  return new RegExp(`^(${categories})(\\.[a-zA-Z0-9_-]+)+$`);
}

/**
 * Regex for validating key format
 */
const KEY_REGEX = getKeyRegex();

/**
 * Checks whether a key is critical
 */
function isCriticalKey(key: string): boolean {
  return CRITICAL_KEYS.has(key);
}

/**
 * Validates the format and prefix of a key
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
 * Redacts a value for the audit log
 */
function redact(value: string | null, max: number = 32): string | null {
  if (value == null) return null;
  const v = String(value);
  return v.length > max ? v.slice(0, max) + '…' : v;
}

/**
 * Schema for retrieving a configuration
 */
const GetConfigSchema = z.object({
  key: z.string().min(1, 'Chiave configurazione non può essere vuota'),
  decrypt: z.boolean().optional().default(false),
});

/**
 * Schema for setting a configuration
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
 * Schema for deleting a configuration
 */
const DeleteConfigSchema = z.object({
  key: z.string().min(1, 'Chiave configurazione non può essere vuota'),
});

/**
 * Schema for listing configurations with pagination and filters
 *
 * @example
 * // Basic paginated list
 * { page: 1, pageSize: 20 }
 *
 * @example
 * // Search by key with filters
 * { q: "ldap", category: "auth", isEncrypted: true, sortBy: "updatedAt", sortDir: "desc" }
 */
const ListConfigsSchema = z.object({
  /** Search by key (case-insensitive) */
  q: z.string().trim().optional(),
  /** Filter by category derived from the key prefix */
  category: z.string().trim().optional(),
  /** Filter by encryption type (true=encrypted, false=plaintext) */
  isEncrypted: z.boolean().optional(),
  /** Sort field */
  sortBy: z.enum(['key', 'updatedAt']).default('key'),
  /** Sort direction */
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  /** Page number (1-based) */
  page: z.number().int().min(1).default(1),
  /** Page size (5-100) */
  pageSize: z.number().int().min(5).max(100).default(20),
});

/**
 * Schema for viewing a configuration value in a safe mode
 *
 * @example
 * // Masked mode (any authenticated user)
 * { key: "auth.ldap.password", mode: "masked" }
 *
 * @example
 * // Raw mode (admin only, generates an audit log)
 * { key: "auth.ldap.password", mode: "raw" }
 */
const ViewValueSchema = z.object({
  /** Key of the configuration to view */
  key: z.string().min(1),
  /**
   * Display mode:
   * - 'masked': encrypted values show [ENCRYPTED], available to all authenticated users
   * - 'raw': decrypts encrypted values, requires admin role and generates a mandatory audit log
   */
  mode: z.enum(['masked', 'raw']).default('masked'),
});

/**
 * Schema for safe JSON export
 *
 * @example
 * // Metadata-only export (no values)
 * { includeValues: false }
 *
 * @example
 * // Export with values (encrypted secrets show [ENCRYPTED])
 * { includeValues: true }
 */
const ExportJsonSchema = z.object({
  /**
   * Whether to include values in the configurations:
   * - false: metadata only (key, category, isEncrypted, updatedAt)
   * - true: includes values, but encrypted secrets always show [ENCRYPTED] for security
   */
  includeValues: z.boolean().optional().default(false),
});

/**
 * Schema for JSON import with validation
 *
 * @example
 * {
 *   "items": [
 *     {"key": "app.name", "value": "Luke", "encrypt": false},
 *     {"key": "auth.ldap.password", "value": "secret", "encrypt": true},
 *     {"key": "auth.ldap.url", "value": null, "encrypt": true} // value: null is skipped
 *   ]
 * }
 */
const ImportJsonSchema = z.object({
  /** Array of configurations to import */
  items: z.array(
    z.object({
      /** Key of the configuration (must respect the allowed format and prefixes) */
      key: z.string().min(1),
      /** Value of the configuration (null = skip this item) */
      value: z.string().nullable(),
      /** Whether to encrypt the value (true = encrypt, false/null = plaintext) */
      encrypt: z.boolean().optional().nullable(),
    })
  ),
});

/**
 * Router for configuration management
 */
/**
 * Helper for upserting a configuration
 * Handles validation, saving, and audit logging
 */
async function upsertConfig(
  ctx: Context,
  key: string,
  value: string,
  encrypt: boolean,
  options: { strictUpdate?: boolean; source?: string } = {}
) {
  // Validates the key
  validateKey(key);

  // Special validation for password policy (security).
  //
  // Duplicates `AppConfigRegistry`, which now declares the same 8-128 range — they used to
  // disagree, this saying 8 while the registry said 6. It stays because writes do not consult the
  // registry at all: this is the general check, approximated for the one key someone needed
  // it for. Making writes validate against the registry is what deletes this block; that work is
  // scoped in docs/TASK_appconfig_write_authority.md.
  if (key === 'security.password.minLength') {
    const minLength = parseInt(value, 10);
    if (isNaN(minLength) || minLength < 8) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Password minLength non può essere inferiore a 8 caratteri',
      });
    }
    if (minLength > 128) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Password minLength non può essere superiore a 128 caratteri',
      });
    }
  }

  // If strictUpdate=true, verifies that the configuration exists
  if (options.strictUpdate) {
    const existingConfig = await ctx.prisma.appConfig.findUnique({
      where: { key },
    });

    if (!existingConfig) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Configurazione '${key}' non trovata. Usa 'set' per creare una nuova configurazione.`,
      });
    }
  }

  await saveConfig(ctx.prisma, key, value, encrypt);

  // Audit log
  await logAudit(ctx, {
    action: 'CONFIG_UPSERT',
    targetType: 'Config',
    targetId: key,
    result: 'SUCCESS',
    metadata: {
      key,
      isEncrypted: encrypt,
      valueRedacted: encrypt ? '[ENCRYPTED]' : redact(value),
      source: options.source,
    },
  });

  return {
    key,
    value: encrypt ? '[CIFRATO]' : value,
    isEncrypted: encrypt,
    message: `Configurazione '${key}' ${
      options.strictUpdate ? 'aggiornata' : 'salvata'
    } con successo`,
  };
}

export const configRouter = router({
  /**
   * Lists AppConfig entries with pagination, filtering by key prefix, category, and encryption status.
   *
   * @auth {config:read}
   * @input {ListConfigsSchema} — q, category, isEncrypted, sortBy, sortDir, page, pageSize.
   * @output {Paginated AppConfig list with metadata.}
   */
  list: protectedProcedure
    .use(requirePermission('config:read'))
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
   * Fetches a single AppConfig value by key; decrypt=true requires admin role.
   *
   * @auth {config:read; admin required for decrypt=true}
   * @input {GetConfigSchema} — key, optional decrypt flag.
   * @output {{ key, value, isEncrypted }} — value is [ENCRYPTED] if encrypted and not decrypted.
   */
  get: protectedProcedure
    .use(requirePermission('config:read'))
    .input(GetConfigSchema)
    .query(async ({ input, ctx }) => {
    // If decrypt=true, verifies that the user is admin
    if (input.decrypt && ctx.session?.user?.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Accesso negato: richiesto ruolo admin per decrittare valori',
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

    let finalValue = config.value;
    if (input.decrypt && config.isEncrypted) {
      const { decryptValue } = await import('../lib/configManager.js');
      finalValue = decryptValue(config.value);
    } else if (!input.decrypt && config.isEncrypted) {
      finalValue = '[ENCRYPTED]';
    }

    return {
      key: input.key,
      value: finalValue,
      isEncrypted: config.isEncrypted,
    };
  }),

  /**
   * Views a config value in masked or raw mode; raw mode requires admin and generates an audit log.
   *
   * @auth {config:read; admin required for mode=raw}
   * @input {ViewValueSchema} — key, mode ("masked" | "raw").
   * @output {{ key, value, isEncrypted, mode }} — value is [ENCRYPTED] in masked mode for secrets.
   */
  viewValue: protectedProcedure
    .use(requirePermission('config:read'))
    .input(ViewValueSchema)
    .query(async ({ input, ctx }) => {
      // If mode=raw, verifies that the user is admin
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
        // Masked mode: shows a placeholder if encrypted, otherwise the full value
        value = config.isEncrypted ? '[ENCRYPTED]' : config.value;
      } else {
        // Raw mode: decrypts if encrypted, otherwise the normal value
        if (config.isEncrypted) {
          try {
            const { decryptValue } = await import('../lib/configManager.js');
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
              cause: error,
            });
          }
        } else {
          value = config.value;
        }

        // Audit log for raw viewing
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
   * Creates or updates a single AppConfig entry (upsert).
   *
   * @auth {config:update}
   * @input {SetConfigSchema} — key (allowed prefix), value, optional encrypt flag, optional category override.
   * @output {{ key, value (redacted if encrypted), isEncrypted, message }}
   */
  set: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('configMutations'))
    .input(SetConfigSchema)
    .use(withIdempotency())
    .mutation(async ({ input, ctx }) => {
      return await upsertConfig(ctx, input.key, input.value, input.encrypt);
    }),

  /**
   * Deletes a single AppConfig entry; blocked for critical keys.
   *
   * @auth {config:update}
   * @input {DeleteConfigSchema} — key to delete.
   * @output {{ key, message }}
   */
  delete: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('configMutations'))
    .input(DeleteConfigSchema)
    .mutation(async ({ input, ctx }) => {
      // Verifies that the configuration exists
      const existingConfig = await ctx.prisma.appConfig.findUnique({
        where: { key: input.key },
      });

      if (!existingConfig) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Configurazione '${input.key}' non trovata`,
        });
      }

      // Critical key protection
      if (isCriticalKey(input.key)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `La chiave '${input.key}' è critica e non può essere eliminata`,
        });
      }

      await deleteConfig(ctx.prisma, input.key);

      // Audit log
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
   * Updates an existing AppConfig entry; fails with NOT_FOUND if the key doesn't exist.
   *
   * @auth {config:update}
   * @input {SetConfigSchema} — key (must already exist), value, optional encrypt flag.
   * @output {{ key, value (redacted if encrypted), isEncrypted, message }}
   */
  update: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('configMutations'))
    .input(SetConfigSchema)
    .use(withIdempotency())
    .mutation(async ({ input, ctx }) => {
      return await upsertConfig(ctx, input.key, input.value, input.encrypt, {
        strictUpdate: true,
      });
    }),

  /**
   * Fetches multiple AppConfig values in a single request; returns partial results on missing keys.
   *
   * @auth {config:read; admin required for decrypt=true}
   * @input {{ keys: string[], decrypt?: boolean }} — list of config keys, optional decrypt flag.
   * @output {Array<{ key, value, found, error? }>}
   */
  getMultiple: protectedProcedure
    .use(requirePermission('config:read'))
    .input(
      z.object({
        keys: z.array(
          z.string().min(1, 'Chiave configurazione non può essere vuota')
        ),
        decrypt: z.boolean().optional().default(false),
      })
    )
    .query(async ({ input, ctx }) => {
      if (input.decrypt && ctx.session.user.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Accesso negato: richiesto ruolo admin per decrittare valori',
        });
      }

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
   * Upserts multiple AppConfig entries in one call; returns per-key success/error results.
   *
   * @auth {config:update}
   * @input {{ configs: Array<{ key, value, encrypt? }> }} — list of key/value pairs to upsert.
   * @output {Array<{ key, success, message?, error? }>}
   */
  setMultiple: protectedProcedure
    .use(requirePermission('config:update'))
    .use(withRateLimit('configMutations'))
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
    .use(withIdempotency())
    .mutation(async ({ input, ctx }) => {
      const results = await Promise.all(
        input.configs.map(async config => {
          try {
            await upsertConfig(ctx, config.key, config.value, config.encrypt);

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
   * Checks whether an AppConfig key exists and whether its value is encrypted.
   *
   * @auth {config:read}
   * @input {{ key: string }}
   * @output {{ key, exists: boolean, isEncrypted?: boolean }}
   */
  exists: protectedProcedure
    .use(requirePermission('config:read'))
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
   * Exports all AppConfig entries as JSON; encrypted values are always shown as [ENCRYPTED].
   *
   * @auth {config:update}
   * @input {ExportJsonSchema} — includeValues flag.
   * @output {{ configs: ExportItem[], exportedAt, includeValues, count }}
   */
  exportJson: protectedProcedure
    .use(requirePermission('config:update'))
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
            ? '[ENCRYPTED]' // Never decrypt secrets in the export
            : config.value
          : null,
        updatedAt: config.updatedAt.toISOString(),
      }));

      // Aggregated audit log
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
   * Imports a batch of AppConfig entries from JSON; skips items with null values.
   *
   * @auth {config:update}
   * @input {ImportJsonSchema} — array of { key, value, encrypt? } items.
   * @output {{ successCount, errorCount, errors: Array<{ key, error }> }}
   */
  importJson: protectedProcedure
    .use(requirePermission('config:update'))
    .input(ImportJsonSchema)
    .mutation(async ({ input, ctx }) => {
      const results = {
        successCount: 0,
        errorCount: 0,
        errors: [] as Array<{ key: string; error: string }>,
      };

      for (const item of input.items) {
        try {
          // If value is null, skip this item
          if (item.value === null) {
            continue;
          }

          // Determines whether to encrypt (default false if unspecified)
          const shouldEncrypt = item.encrypt === true;

          await upsertConfig(ctx, item.key, item.value, shouldEncrypt, {
            source: 'import',
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
