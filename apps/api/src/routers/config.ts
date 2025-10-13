/**
 * Router tRPC per gestione configurazioni
 * Implementa CRUD per AppConfig con supporto per valori cifrati
 */

import { z } from 'zod';
import { router, loggedProcedure } from '../lib/trpc';
import { TRPCError } from '@trpc/server';
import {
  saveConfig,
  getConfig,
  listConfigs,
  deleteConfig,
} from '../lib/configManager';

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
  key: z.string().min(1, 'Chiave configurazione non può essere vuota'),
  value: z.string(),
  encrypt: z.boolean().optional().default(false),
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
  decrypt: z.boolean().optional().default(false),
});

/**
 * Router per gestione configurazioni
 */
export const configRouter = router({
  /**
   * Lista tutte le configurazioni
   */
  list: loggedProcedure
    .input(ListConfigsSchema)
    .query(async ({ input, ctx }) => {
      const configs = await listConfigs(ctx.prisma, input.decrypt);

      return configs.map(config => ({
        key: config.key,
        value: config.value,
        isEncrypted: config.isEncrypted,
      }));
    }),

  /**
   * Ottiene una configurazione specifica
   */
  get: loggedProcedure.input(GetConfigSchema).query(async ({ input, ctx }) => {
    const value = await getConfig(ctx.prisma, input.key, input.decrypt);

    if (value === null) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Configurazione '${input.key}' non trovata`,
      });
    }

    return {
      key: input.key,
      value,
      isEncrypted: input.decrypt ? false : undefined, // Non possiamo sapere se è cifrata senza query separata
    };
  }),

  /**
   * Imposta una configurazione
   */
  set: loggedProcedure
    .input(SetConfigSchema)
    .mutation(async ({ input, ctx }) => {
      await saveConfig(ctx.prisma, input.key, input.value, input.encrypt);

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
  delete: loggedProcedure
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

      await deleteConfig(ctx.prisma, input.key);

      return {
        key: input.key,
        message: `Configurazione '${input.key}' eliminata con successo`,
      };
    }),

  /**
   * Aggiorna una configurazione esistente
   */
  update: loggedProcedure
    .input(SetConfigSchema)
    .mutation(async ({ input, ctx }) => {
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
  setMultiple: loggedProcedure
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
            await saveConfig(
              ctx.prisma,
              config.key,
              config.value,
              config.encrypt
            );
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
});
