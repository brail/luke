/**
 * Router tRPC per gestione Brand
 * Implementa CRUD completo per Brand con audit logging
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, adminOrEditorProcedure } from '../lib/trpc';

/**
 * Schema per input Brand
 */
const brandInputSchema = z.object({
  code: z.string().min(1, 'Codice obbligatorio').max(16, 'Max 16 caratteri'),
  name: z.string().min(1, 'Nome obbligatorio').max(128, 'Max 128 caratteri'),
  logoUrl: z.string().url('URL non valido').nullable().optional(),
  isActive: z.boolean().default(true),
});

/**
 * Schema per ID Brand
 */
const brandIdSchema = z.object({
  id: z.string().uuid('ID brand non valido'),
});

/**
 * Router per gestione Brand
 */
export const brandRouter = router({
  /**
   * Lista tutti i brand con filtri opzionali
   * Richiede ruolo admin o editor
   */
  list: adminOrEditorProcedure
    .input(
      z
        .object({
          isActive: z.boolean().optional(),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { isActive, search } = input || {};

      const where: any = {};

      if (typeof isActive === 'boolean') {
        where.isActive = isActive;
      }

      if (search && search.trim()) {
        where.OR = [
          { code: { contains: search } },
          { name: { contains: search } },
        ];
      }

      return ctx.prisma.brand.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          logoUrl: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }),

  /**
   * Crea un nuovo brand
   * Richiede ruolo admin o editor
   */
  create: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(brandInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Verifica che il codice non esista già
      const existingBrand = await ctx.prisma.brand.findUnique({
        where: { code: input.code },
      });

      if (existingBrand) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Codice brand già esistente',
        });
      }

      const created = await ctx.prisma.brand.create({
        data: input,
      });

      // Audit logging gestito automaticamente dal middleware withAuditLog

      return {
        id: created.id,
        code: created.code,
        name: created.name,
        logoUrl: created.logoUrl,
        isActive: created.isActive,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    }),

  /**
   * Aggiorna un brand esistente
   * Richiede ruolo admin o editor
   */
  update: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: brandInputSchema.partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, data } = input;

      // Verifica che il brand esista
      const existingBrand = await ctx.prisma.brand.findUnique({
        where: { id },
      });

      if (!existingBrand) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Brand non trovato',
        });
      }

      // Se si sta aggiornando il codice, verifica che non esista già
      if (data.code && data.code !== existingBrand.code) {
        const conflictingBrand = await ctx.prisma.brand.findUnique({
          where: { code: data.code },
        });

        if (conflictingBrand) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Codice brand già esistente',
          });
        }
      }

      const updated = await ctx.prisma.brand.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      // Audit logging gestito automaticamente dal middleware withAuditLog

      return {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        logoUrl: updated.logoUrl,
        isActive: updated.isActive,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    }),

  /**
   * Elimina un brand (soft delete)
   * Imposta isActive = false invece di eliminare il record
   * Richiede ruolo admin o editor
   */
  remove: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(brandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const { id } = input;

      // Verifica che il brand esista
      const existingBrand = await ctx.prisma.brand.findUnique({
        where: { id },
      });

      if (!existingBrand) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Brand non trovato',
        });
      }

      // Soft delete: imposta isActive = false
      const deletedBrand = await ctx.prisma.brand.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      // Audit logging gestito automaticamente dal middleware withAuditLog

      return {
        id: deletedBrand.id,
        code: deletedBrand.code,
        name: deletedBrand.name,
        logoUrl: deletedBrand.logoUrl,
        isActive: deletedBrand.isActive,
        createdAt: deletedBrand.createdAt,
        updatedAt: deletedBrand.updatedAt,
      };
    }),

  /**
   * Hard delete di un brand (elimina completamente dal database)
   * ATTENZIONE: Questa operazione è irreversibile
   * Richiede ruolo admin o editor
   */
  hardDelete: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(brandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const { id } = input;

      // Verifica che il brand esista
      const existingBrand = await ctx.prisma.brand.findUnique({
        where: { id },
      });

      if (!existingBrand) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Brand non trovato',
        });
      }

      // Hard delete: elimina brand dal database
      try {
        await ctx.prisma.brand.delete({
          where: { id },
        });

        // Log SUCCESS dopo delete riuscita
        await logAudit(ctx, {
          action: 'BRAND_HARD_DELETE',
          targetType: 'Brand',
          targetId: id,
          result: 'SUCCESS',
          metadata: {
            deletedCode: existingBrand.code,
            deletedName: existingBrand.name,
          },
        });

        return { success: true, message: 'Brand eliminato definitivamente' };
      } catch (error) {
        // Log FAILURE in catch
        await logAudit(ctx, {
          action: 'BRAND_HARD_DELETE',
          targetType: 'Brand',
          targetId: id,
          result: 'FAILURE',
          metadata: {
            errorCode: (error as any).code || 'UNKNOWN',
            errorMessage: (error as any).message?.substring(0, 100),
          },
        });
        throw error;
      }
    }),
});
