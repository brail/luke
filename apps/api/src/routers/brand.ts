/**
 * Router tRPC per gestione Brand
 * Implementa CRUD completo per Brand con audit logging
 */

import { TRPCError } from '@trpc/server';

import {
  BrandInputSchema,
  BrandIdSchema,
  BrandListInputSchema,
  BrandUpdateInputSchema,
  normalizeCode,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, adminOrEditorProcedure } from '../lib/trpc';
import { deleteObject } from '../storage';
import { moveTempLogoToBrand } from '../services/brandLogo.service';

/**
 * Costruisce la clausola WHERE per le query Brand
 */
function buildWhereClause(filters: {
  isActive?: boolean;
  search?: string;
}): any {
  const where: any = {};

  if (typeof filters.isActive === 'boolean') {
    where.isActive = filters.isActive;
  }

  if (filters.search && filters.search.trim()) {
    where.OR = [
      { code: { contains: filters.search } },
      { name: { contains: filters.search } },
    ];
  }

  return where;
}

/**
 * Estrae key dal logoUrl per cleanup
 */
function extractKeyFromUrl(logoUrl: string): string {
  // logoUrl format: /api/uploads/brand-logos/{year}/{month}/{day}/{filename}
  // oppure: /uploads/brand-logos/{year}/{month}/{day}/{filename}
  const urlParts = logoUrl.split('/');
  const brandLogosIndex = urlParts.findIndex(part => part === 'brand-logos');

  if (brandLogosIndex === -1) {
    throw new Error(`Invalid logoUrl format: ${logoUrl}`);
  }

  // Ritorna tutto dopo 'brand-logos/'
  return urlParts.slice(brandLogosIndex + 1).join('/');
}

/**
 * Router per gestione Brand
 */
export const brandRouter = router({
  /**
   * Lista tutti i brand con filtri opzionali e cursor pagination
   * Richiede ruolo admin o editor
   */
  list: adminOrEditorProcedure
    .input(BrandListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 50;

      const items = await ctx.prisma.brand.findMany({
        where: buildWhereClause(input || {}),
        take: limit + 1, // Prendi uno in più per determinare se ci sono altri risultati
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], // Ordine deterministico per cursor
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

      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? results[results.length - 1].id : null;

      return {
        items: results,
        nextCursor,
        hasMore: !!nextCursor,
      };
    }),

  /**
   * Crea un nuovo brand
   * Richiede ruolo admin o editor
   */
  create: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(BrandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const normalizedCode = normalizeCode(input.code);

      return ctx.prisma.$transaction(async tx => {
        // Verifica che il codice normalizzato non esista già
        const existingBrand = await tx.brand.findUnique({
          where: { code: normalizedCode },
        });

        if (existingBrand) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Codice brand già esistente',
          });
        }

        const created = await tx.brand.create({
          data: { ...input, code: normalizedCode },
        });

        // Se presente tempLogoId, sposta file temporaneo
        let finalLogoUrl = created.logoUrl;
        if (input.tempLogoId) {
          try {
            const moveResult = await moveTempLogoToBrand(ctx, {
              tempLogoId: input.tempLogoId,
              brandId: created.id,
            });
            finalLogoUrl = moveResult.url;
          } catch (moveError) {
            // Log errore ma non fallire la creazione del brand
            ctx.logger?.warn(
              { moveError },
              'Failed to move temp logo to brand'
            );
          }
        }

        // Audit logging gestito automaticamente dal middleware withAuditLog

        return {
          id: created.id,
          code: created.code,
          name: created.name,
          logoUrl: finalLogoUrl,
          isActive: created.isActive,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        };
      });
    }),

  /**
   * Aggiorna un brand esistente
   * Richiede ruolo admin o editor
   */
  update: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(BrandUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.prisma.$transaction(async tx => {
        // Verifica che il brand esista
        const existingBrand = await tx.brand.findUnique({
          where: { id: input.id },
        });

        if (!existingBrand) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Brand non trovato',
          });
        }

        // Se si sta aggiornando il codice, verifica che non esista già
        if (input.data.code && input.data.code !== existingBrand.code) {
          const normalizedCode = normalizeCode(input.data.code);
          const conflictingBrand = await tx.brand.findFirst({
            where: {
              code: normalizedCode,
              id: { not: input.id },
            },
          });

          if (conflictingBrand) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice brand già esistente',
            });
          }

          // Aggiorna il codice con la versione normalizzata
          input.data.code = normalizedCode;
        }

        const updated = await tx.brand.update({
          where: { id: input.id },
          data: {
            ...input.data,
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
      });
    }),

  /**
   * Elimina un brand (soft delete)
   * Imposta isActive = false invece di eliminare il record
   * Richiede ruolo admin o editor
   */
  remove: adminOrEditorProcedure
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
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
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.prisma.$transaction(async tx => {
        // Verifica che il brand esista
        const brand = await tx.brand.findUnique({
          where: { id: input.id },
        });

        if (!brand) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Brand non trovato',
          });
        }

        // Check integrità referenziale: verifica se brand è in uso nelle preferenze utente
        const referencedInPreferences = await tx.userPreference.findFirst({
          where: { lastBrandId: input.id },
          select: { userId: true },
        });

        if (referencedInPreferences) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'Impossibile eliminare: brand in uso nelle preferenze utente',
          });
        }

        // Hard delete: elimina brand dal database
        await tx.brand.delete({
          where: { id: input.id },
        });

        // Cleanup logo file (best-effort, fuori transazione)
        if (brand.logoUrl) {
          setImmediate(async () => {
            try {
              const key = extractKeyFromUrl(brand.logoUrl!);
              await deleteObject(ctx, key);
            } catch (err) {
              ctx.logger?.warn(
                { err },
                'Failed to delete logo during hardDelete'
              );
            }
          });
        }

        // Log SUCCESS dopo delete riuscita
        await logAudit(ctx, {
          action: 'BRAND_HARD_DELETE',
          targetType: 'Brand',
          targetId: input.id,
          result: 'SUCCESS',
          metadata: {
            deletedCode: brand.code,
            deletedName: brand.name,
          },
        });

        return { success: true, message: 'Brand eliminato definitivamente' };
      });
    }),
});
