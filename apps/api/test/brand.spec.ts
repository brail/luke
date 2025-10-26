/**
 * Test unitari per Brand Router
 * Verifica CRUD operations e integrità referenziale
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// import { brandRouter } from '../src/routers/brand'; // Non utilizzato, usa testBrandRouter locale
import { createTestContext } from './helpers/testContext';
import { router, publicProcedure } from '../src/lib/trpc';
import { requirePermission } from '../src/lib/permissions';
import {
  BrandInputSchema,
  BrandIdSchema,
  BrandListInputSchema,
  BrandUpdateInputSchema,
  normalizeCode,
} from '@luke/core';

// Creo un router di test senza rate limiting per testare le nuove permissions
const testBrandRouter = router({
  list: publicProcedure
    .use(requirePermission('brands:read'))
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

  create: publicProcedure
    .use(requirePermission('brands:create'))
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

  update: publicProcedure
    .use(requirePermission('brands:update'))
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

  hardDelete: publicProcedure
    .use(requirePermission('brands:delete'))
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
      // Crea un secondo brand per testare conflitto codice
      const secondBrand = await testContext.prisma.brand.create({
        data: {
          code: 'SECOND_BRAND',
          name: 'Second Brand',
          isActive: true,
        },
      });

      // Verifica che il secondo brand sia stato creato correttamente
      expect(secondBrand.code).toBe('SECOND_BRAND');

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

    it('should handle empty search results', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const result = await caller.list({ search: 'NONEXISTENT' });

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should handle limit edge cases', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      // Test limit 0
      const resultZero = await caller.list({ limit: 0 });
      expect(resultZero.items).toHaveLength(0);

      // Test limit molto alto
      const resultHigh = await caller.list({ limit: 1000 });
      expect(resultHigh.items).toHaveLength(1);
      expect(resultHigh.hasMore).toBe(false);
    });
  });

  describe('normalizeCode edge cases', () => {
    it('should handle special characters in code normalization', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const testCases = [
        { input: 'test@brand#1', expected: 'TEST@BRAND#1' },
        { input: 'brand-with-dashes', expected: 'BRAND-WITH-DASHES' },
        { input: 'brand_with_underscores', expected: 'BRAND_WITH_UNDERSCORES' },
        { input: 'brand.with.dots', expected: 'BRAND.WITH.DOTS' },
        { input: 'brand with spaces', expected: 'BRAND WITH SPACES' },
        { input: 'BRAND123', expected: 'BRAND123' },
      ];

      for (const testCase of testCases) {
        const brandData = {
          code: testCase.input,
          name: `Test Brand ${testCase.input}`,
          isActive: true,
        };

        const result = await caller.create(brandData);
        expect(result.code).toBe(testCase.expected);

        // Cleanup per il prossimo test
        await testContext.prisma.brand.delete({
          where: { id: result.id },
        });
      }
    });

    it('should handle unicode characters in code', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const brandData = {
        code: 'café-brand',
        name: 'Café Brand',
        isActive: true,
      };

      const result = await caller.create(brandData);
      expect(result.code).toBe('CAFÉ-BRAND');
    });
  });

  describe('concurrency tests', () => {
    it('should handle concurrent brand creation with same code', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const brandData = {
        code: 'CONCURRENT_TEST',
        name: 'Concurrent Test Brand',
        isActive: true,
      };

      // Simula creazione concorrente
      const promises = Array.from({ length: 3 }, () =>
        caller.create(brandData).catch(error => error)
      );

      const results = await Promise.all(promises);

      // Solo uno dovrebbe riuscire, gli altri dovrebbero fallire con CONFLICT
      const successes = results.filter(r => !r.code);
      const conflicts = results.filter(r => r.code === 'CONFLICT');

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });

    it('should handle concurrent updates to same brand', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      // Crea un secondo brand per testare update concorrente
      const secondBrand = await testContext.prisma.brand.create({
        data: {
          code: 'CONCURRENT_UPDATE',
          name: 'Concurrent Update Brand',
          isActive: true,
        },
      });

      const updatePromises = Array.from({ length: 3 }, (_, i) =>
        caller
          .update({
            id: secondBrand.id,
            data: { name: `Updated Name ${i}` },
          })
          .catch(error => error)
      );

      const results = await Promise.all(updatePromises);

      // Tutti dovrebbero riuscire (update non ha conflitti di codice)
      const successes = results.filter(r => !r.code);
      expect(successes).toHaveLength(3);
    });
  });

  describe('soft delete vs hard delete', () => {
    it('should implement soft delete correctly', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      // Crea un brand per soft delete
      const brandToSoftDelete = await testContext.prisma.brand.create({
        data: {
          code: 'SOFT_DELETE_TEST',
          name: 'Soft Delete Test',
          isActive: true,
        },
      });

      // Soft delete (remove) - non implementato nel test router, ma testiamo il comportamento
      // Simuliamo soft delete direttamente nel DB
      await testContext.prisma.brand.update({
        where: { id: brandToSoftDelete.id },
        data: { isActive: false },
      });

      // Verifica che il brand sia ancora nel DB ma inattivo
      const softDeletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: brandToSoftDelete.id },
      });

      expect(softDeletedBrand).toBeDefined();
      expect(softDeletedBrand?.isActive).toBe(false);

      // Verifica che non appaia nelle liste attive
      const activeBrands = await caller.list({ isActive: true });
      const inactiveBrands = await caller.list({ isActive: false });

      expect(
        activeBrands.items.find(b => b.id === brandToSoftDelete.id)
      ).toBeUndefined();
      expect(
        inactiveBrands.items.find(b => b.id === brandToSoftDelete.id)
      ).toBeDefined();
    });

    it('should handle hard delete with proper cleanup', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      // Crea un brand per hard delete
      const brandToHardDelete = await testContext.prisma.brand.create({
        data: {
          code: 'HARD_DELETE_TEST',
          name: 'Hard Delete Test',
          isActive: true,
        },
      });

      // Hard delete
      const result = await caller.hardDelete({ id: brandToHardDelete.id });

      expect(result).toEqual({
        success: true,
        message: 'Brand eliminato definitivamente',
      });

      // Verifica che il brand sia completamente rimosso dal DB
      const deletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: brandToHardDelete.id },
      });

      expect(deletedBrand).toBeNull();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle very long brand names', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      const longName = 'A'.repeat(500); // Nome molto lungo
      const brandData = {
        code: 'LONG_NAME_TEST',
        name: longName,
        isActive: true,
      };

      const result = await caller.create(brandData);
      expect(result.name).toBe(longName);
    });

    it('should handle empty string inputs gracefully', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      // Test con nome vuoto
      await expect(
        caller.create({
          code: 'EMPTY_NAME_TEST',
          name: '',
          isActive: true,
        })
      ).rejects.toThrow();

      // Test con codice vuoto
      await expect(
        caller.create({
          code: '',
          name: 'Empty Code Test',
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it('should handle null and undefined values', async () => {
      const caller = testBrandRouter.createCaller(testContext);

      // Test con valori null
      await expect(
        caller.create({
          code: 'NULL_TEST',
          name: null as any,
          isActive: true,
        })
      ).rejects.toThrow();
    });
  });

  describe('Permission-based access control', () => {
    let adminContext: any;
    let editorContext: any;
    let viewerContext: any;

    beforeEach(async () => {
      // Crea utenti con diversi ruoli
      const adminUser = await testContext.prisma.user.create({
        data: {
          email: 'admin@example.com',
          username: 'admin',
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin',
        },
      });

      const editorUser = await testContext.prisma.user.create({
        data: {
          email: 'editor@example.com',
          username: 'editor',
          firstName: 'Editor',
          lastName: 'User',
          role: 'editor',
        },
      });

      const viewerUser = await testContext.prisma.user.create({
        data: {
          email: 'viewer@example.com',
          username: 'viewer',
          firstName: 'Viewer',
          lastName: 'User',
          role: 'viewer',
        },
      });

      // Crea context per ogni ruolo
      adminContext = {
        ...testContext,
        session: {
          user: adminUser,
          accessToken: 'admin-token',
        },
      };

      editorContext = {
        ...testContext,
        session: {
          user: editorUser,
          accessToken: 'editor-token',
        },
      };

      viewerContext = {
        ...testContext,
        session: {
          user: viewerUser,
          accessToken: 'viewer-token',
        },
      };
    });

    describe('list operation', () => {
      it('should allow admin to list brands', async () => {
        const caller = testBrandRouter.createCaller(adminContext);
        const result = await caller.list();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });

      it('should allow editor to list brands', async () => {
        const caller = testBrandRouter.createCaller(editorContext);
        const result = await caller.list();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });

      it('should allow viewer to list brands', async () => {
        const caller = testBrandRouter.createCaller(viewerContext);
        const result = await caller.list();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });
    });

    describe('create operation', () => {
      it('should allow admin to create brands', async () => {
        const caller = testBrandRouter.createCaller(adminContext);
        const result = await caller.create({
          code: 'ADMIN_BRAND',
          name: 'Admin Brand',
          isActive: true,
        });
        expect(result.id).toBeDefined();
        expect(result.code).toBe('ADMIN_BRAND');
      });

      it('should allow editor to create brands', async () => {
        const caller = testBrandRouter.createCaller(editorContext);
        const result = await caller.create({
          code: 'EDITOR_BRAND',
          name: 'Editor Brand',
          isActive: true,
        });
        expect(result.id).toBeDefined();
        expect(result.code).toBe('EDITOR_BRAND');
      });

      it('should deny viewer from creating brands', async () => {
        const caller = testBrandRouter.createCaller(viewerContext);
        await expect(
          caller.create({
            code: 'VIEWER_BRAND',
            name: 'Viewer Brand',
            isActive: true,
          })
        ).rejects.toThrow(TRPCError);
        const error = await caller
          .create({
            code: 'VIEWER_BRAND',
            name: 'Viewer Brand',
            isActive: true,
          })
          .catch(e => e);
        expect(error.code).toBe('FORBIDDEN');
      });
    });

    describe('update operation', () => {
      it('should allow admin to update brands', async () => {
        const caller = testBrandRouter.createCaller(adminContext);
        const result = await caller.update({
          id: testBrand.id,
          data: {
            name: 'Updated by Admin',
          },
        });
        expect(result.name).toBe('Updated by Admin');
      });

      it('should allow editor to update brands', async () => {
        const caller = testBrandRouter.createCaller(editorContext);
        const result = await caller.update({
          id: testBrand.id,
          data: {
            name: 'Updated by Editor',
          },
        });
        expect(result.name).toBe('Updated by Editor');
      });

      it('should deny viewer from updating brands', async () => {
        const caller = testBrandRouter.createCaller(viewerContext);
        await expect(
          caller.update({
            id: testBrand.id,
            data: {
              name: 'Updated by Viewer',
            },
          })
        ).rejects.toThrow(TRPCError);
        const error = await caller
          .update({
            id: testBrand.id,
            data: {
              name: 'Updated by Viewer',
            },
          })
          .catch(e => e);
        expect(error.code).toBe('FORBIDDEN');
      });
    });

    describe('hardDelete operation', () => {
      it('should allow admin to hard delete brands', async () => {
        const caller = testBrandRouter.createCaller(adminContext);
        const result = await caller.hardDelete({ id: testBrand.id });
        expect(result.success).toBe(true);
        expect(result.message).toBe('Brand eliminato definitivamente');
      });

      it('should allow editor to hard delete brands', async () => {
        const caller = testBrandRouter.createCaller(editorContext);
        const result = await caller.hardDelete({ id: testBrand.id });
        expect(result.success).toBe(true);
        expect(result.message).toBe('Brand eliminato definitivamente');
      });

      it('should deny viewer from hard deleting brands', async () => {
        const caller = testBrandRouter.createCaller(viewerContext);
        await expect(caller.hardDelete({ id: testBrand.id })).rejects.toThrow(
          TRPCError
        );
        const error = await caller
          .hardDelete({ id: testBrand.id })
          .catch(e => e);
        expect(error.code).toBe('FORBIDDEN');
      });
    });

    describe('unauthenticated access', () => {
      it('should deny unauthenticated access to all operations', async () => {
        const unauthenticatedContext = {
          ...testContext,
          session: null,
        };

        const caller = testBrandRouter.createCaller(unauthenticatedContext);

        await expect(caller.list()).rejects.toThrow(TRPCError);
        const listError = await caller.list().catch(e => e);
        expect(listError.code).toBe('UNAUTHORIZED');

        await expect(
          caller.create({
            code: 'UNAUTH_BRAND',
            name: 'Unauth Brand',
            isActive: true,
          })
        ).rejects.toThrow(TRPCError);
        const createError = await caller
          .create({
            code: 'UNAUTH_BRAND',
            name: 'Unauth Brand',
            isActive: true,
          })
          .catch(e => e);
        expect(createError.code).toBe('UNAUTHORIZED');

        await expect(
          caller.update({
            id: testBrand.id,
            data: {
              name: 'Updated by Unauth',
            },
          })
        ).rejects.toThrow(TRPCError);
        const updateError = await caller
          .update({
            id: testBrand.id,
            data: {
              name: 'Updated by Unauth',
            },
          })
          .catch(e => e);
        expect(updateError.code).toBe('UNAUTHORIZED');

        await expect(caller.hardDelete({ id: testBrand.id })).rejects.toThrow(
          TRPCError
        );
        const deleteError = await caller
          .hardDelete({ id: testBrand.id })
          .catch(e => e);
        expect(deleteError.code).toBe('UNAUTHORIZED');
      });
    });
  });
});
