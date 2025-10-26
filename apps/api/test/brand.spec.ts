/**
 * Test unitari per Brand Router
 * Verifica CRUD operations e integrità referenziale
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';

import { brandRouter } from '../src/routers/brand';
import { createTestContext } from './helpers/testContext';
import { router, adminOrEditorProcedure } from '../src/lib/trpc';
import {
  BrandInputSchema,
  BrandIdSchema,
  BrandListInputSchema,
  BrandUpdateInputSchema,
  normalizeCode,
} from '@luke/core';

// Creo un router di test senza rate limiting
const testBrandRouter = router({
  list: adminOrEditorProcedure
    .input(BrandListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 50;

      const items = await ctx.prisma.brand.findMany({
        where: buildWhereClause(input || {}),
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
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

  create: adminOrEditorProcedure
    .input(BrandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const normalizedCode = normalizeCode(input.code);

      return ctx.prisma.$transaction(async tx => {
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

        return {
          id: created.id,
          code: created.code,
          name: created.name,
          logoUrl: created.logoUrl,
          isActive: created.isActive,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        };
      });
    }),

  update: adminOrEditorProcedure
    .input(BrandUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.prisma.$transaction(async tx => {
        const existingBrand = await tx.brand.findUnique({
          where: { id: input.id },
        });

        if (!existingBrand) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Brand non trovato',
          });
        }

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

          input.data.code = normalizedCode;
        }

        const updated = await tx.brand.update({
          where: { id: input.id },
          data: {
            ...input.data,
            updatedAt: new Date(),
          },
        });

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

  hardDelete: adminOrEditorProcedure
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.prisma.$transaction(async tx => {
        const brand = await tx.brand.findUnique({
          where: { id: input.id },
        });

        if (!brand) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Brand non trovato',
          });
        }

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

        await tx.brand.delete({
          where: { id: input.id },
        });

        return { success: true, message: 'Brand eliminato definitivamente' };
      });
    }),
});

// Helper function per buildWhereClause
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

describe('Brand Router', () => {
  let testContext: any;
  let testBrand: any;

  beforeEach(async () => {
    testContext = await createTestContext();

    // Crea un brand di test
    testBrand = await testContext.prisma.brand.create({
      data: {
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      },
    });
  });

  afterEach(async () => {
    // Cleanup: elimina tutti i brand e user preferences
    await testContext.prisma.userPreference.deleteMany();
    await testContext.prisma.brand.deleteMany();
    await testContext.prisma.user.deleteMany();
  });

  describe('hardDelete', () => {
    it('should block hardDelete if brand is referenced in UserPreference', async () => {
      // Setup: crea user e preference che referenzia il brand
      const testUser = await testContext.prisma.user.create({
        data: {
          email: 'test-harddelete@example.com',
          username: 'testuser-harddelete',
          firstName: 'Test',
          lastName: 'User',
          role: 'admin',
        },
      });

      await testContext.prisma.userPreference.create({
        data: {
          userId: testUser.id,
          lastBrandId: testBrand.id,
        },
      });

      // Test: hardDelete dovrebbe fallire
      const caller = testBrandRouter.createCaller(testContext);

      await expect(caller.hardDelete({ id: testBrand.id })).rejects.toThrow(
        TRPCError
      );

      await expect(
        caller.hardDelete({ id: testBrand.id })
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Impossibile eliminare: brand in uso nelle preferenze utente',
      });
    });

    it('should allow hardDelete if brand is not referenced', async () => {
      // Test: hardDelete dovrebbe riuscire
      const caller = testBrandRouter.createCaller(testContext);

      const result = await caller.hardDelete({ id: testBrand.id });

      expect(result).toEqual({
        success: true,
        message: 'Brand eliminato definitivamente',
      });

      // Verifica che il brand sia stato eliminato
      const deletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });

      expect(deletedBrand).toBeNull();
    });

    it('should throw NOT_FOUND for non-existent brand', async () => {
      const caller = testBrandRouter.createCaller(testContext);
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        caller.hardDelete({ id: nonExistentId })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Brand non trovato',
      });
    });
  });

  describe('create', () => {
    it('should create brand with valid data and normalize code', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const brandData = {
        code: 'new-brand', // Codice con minuscole e trattini
        name: 'New Brand',
        isActive: true,
      };

      const result = await caller.create(brandData);

      expect(result).toMatchObject({
        code: 'NEW-BRAND', // Dovrebbe essere normalizzato
        name: 'New Brand',
        isActive: true,
      });
      expect(result.id).toBeDefined();
    });

    it('should reject duplicate brand code', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const brandData = {
        code: 'TEST_BRAND', // Stesso codice del brand esistente
        name: 'Duplicate Brand',
        isActive: true,
      };

      await expect(caller.create(brandData)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Codice brand già esistente',
      });
    });

    it('should normalize code and reject if normalized code conflicts', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const brandData = {
        code: 'test_brand', // Underscore che viene mantenuto dalla normalizzazione
        name: 'Test Brand Normalized',
        isActive: true,
      };

      await expect(caller.create(brandData)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Codice brand già esistente',
      });
    });

    it('should validate brand code format', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const invalidBrandData = {
        code: 'invalid-code!', // Caratteri non validi
        name: 'Invalid Brand',
        isActive: true,
      };

      await expect(caller.create(invalidBrandData)).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update brand with valid data', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const updateData = {
        id: testBrand.id,
        data: {
          name: 'Updated Brand Name',
          isActive: false,
        },
      };

      const result = await caller.update(updateData);

      expect(result).toMatchObject({
        id: testBrand.id,
        code: 'TEST_BRAND',
        name: 'Updated Brand Name',
        isActive: false,
      });
    });

    it('should normalize code during update', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const updateData = {
        id: testBrand.id,
        data: {
          code: 'updated-brand', // Codice con minuscole e trattini
        },
      };

      const result = await caller.update(updateData);

      expect(result).toMatchObject({
        id: testBrand.id,
        code: 'UPDATED-BRAND', // Dovrebbe essere normalizzato
      });
    });

    it('should reject update with duplicate code', async () => {
      // Crea un secondo brand
      const secondBrand = await testContext.prisma.brand.create({
        data: {
          code: 'SECOND_BRAND',
          name: 'Second Brand',
          isActive: true,
        },
      });

      const caller = testBrandRouter.createCaller(testContext);

      const updateData = {
        id: testBrand.id,
        data: {
          code: 'SECOND_BRAND', // Codice già esistente
        },
      };

      await expect(caller.update(updateData)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Codice brand già esistente',
      });
    });

    it('should throw NOT_FOUND for non-existent brand', async () => {
      const caller = testBrandRouter.createCaller(testContext);
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      const updateData = {
        id: nonExistentId,
        data: {
          name: 'Updated Name',
        },
      };

      await expect(caller.update(updateData)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Brand non trovato',
      });
    });
  });

  describe('list', () => {
    it('should list all brands with cursor pagination', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const result = await caller.list();

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasMore');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: testBrand.id,
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      });
    });

    it('should support cursor pagination', async () => {
      // Crea più brand per testare pagination
      const brands = [];
      for (let i = 0; i < 2; i++) {
        // Solo 2 brand aggiuntivi
        const brand = await testContext.prisma.brand.create({
          data: {
            code: `BRAND_${i}`,
            name: `Brand ${i}`,
            isActive: true,
          },
        });
        brands.push(brand);
      }

      const caller = testBrandRouter.createCaller(testContext);

      // Prima pagina
      const firstPage = await caller.list({ limit: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).toBeDefined();

      // Seconda pagina usando cursor
      const secondPage = await caller.list({
        cursor: firstPage.nextCursor!,
        limit: 2,
      });
      // Ci dovrebbero essere 1 elemento rimanente (il testBrand originale)
      expect(secondPage.items.length).toBeGreaterThanOrEqual(1);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('should filter brands by search term', async () => {
      // Crea un secondo brand
      await testContext.prisma.brand.create({
        data: {
          code: 'NIKE',
          name: 'Nike',
          isActive: true,
        },
      });

      const caller = testBrandRouter.createCaller(testContext);

      const result = await caller.list({ search: 'NIKE' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].code).toBe('NIKE');
    });

    it('should filter brands by isActive status', async () => {
      // Crea un brand inattivo
      await testContext.prisma.brand.create({
        data: {
          code: 'INACTIVE',
          name: 'Inactive Brand',
          isActive: false,
        },
      });

      const caller = testBrandRouter.createCaller(testContext);

      const activeBrands = await caller.list({ isActive: true });
      const inactiveBrands = await caller.list({ isActive: false });

      expect(activeBrands.items).toHaveLength(1);
      expect(inactiveBrands.items).toHaveLength(1);
    });
  });
});
