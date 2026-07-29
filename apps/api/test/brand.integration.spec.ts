/**
 * Test del Brand Router.
 *
 * Esercita il router **reale** (`brandRouter`). La versione precedente ne
 * reimplementava una copia locale (`testBrandRouter`) per aggirare il rate limit:
 * una copia però non è il codice di produzione, e infatti era rimasta indietro su
 * `logoUrl`→`logoKey`, sulle precondizioni di `hardDelete` e su
 * `UserPreference.lastBrandId` (oggi dentro il blob JSON `data`). Un test che
 * verifica una copia non dice nulla su ciò che gira davvero.
 *
 * Il rate limit si neutralizza azzerando lo store fra i test, non duplicando
 * il router.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach } from 'vitest';

import { rateLimitStore } from '../src/lib/ratelimit';
import { brandRouter } from '../src/routers/brand';

import { resetTestData } from './helpers/database';
import { createTestContext } from './helpers/testContext';

describe('Brand Router', () => {
  let testContext: any;
  let testBrand: any;

  beforeEach(async () => {
    // Il router reale è rate-limited: senza azzerare lo store i test si
    // bloccherebbero a vicenda dopo poche mutation.
    rateLimitStore.clear();

    // Troncamento con CASCADE prima di costruire il context: i test creano anche
    // season, collection layout e nav brand, e un delete selettivo su `brand`
    // sbatte contro le foreign key lasciando il database sporco per il test dopo.
    // Va fatto PRIMA di `createTestContext`, che inserisce l'utente di sessione.
    await resetTestData();

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

  describe('hardDelete', () => {
    // Le precondizioni di hardDelete sono cambiate: non è più il riferimento in
    // `UserPreference` a bloccare (quel campo vive ora nel blob JSON `data`, non
    // più come colonna `lastBrandId`), ma il collegamento a NAV e l'uso del brand
    // in collection layout o set di pricing.
    it('should block hardDelete if brand is used by a collection layout', async () => {
      const season = await testContext.prisma.season.create({
        data: { code: `HD${Date.now() % 100000}`, name: 'HardDelete Season', year: 2099, isActive: true },
      });
      await testContext.prisma.collectionLayout.create({
        data: { brandId: testBrand.id, seasonId: season.id },
      });

      const caller = brandRouter.createCaller(testContext);

      await expect(
        caller.hardDelete({ id: testBrand.id })
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it('should block hardDelete if brand is linked to NAV', async () => {
      const navBrand = await testContext.prisma.navBrand.create({
        data: {
          navCode: `NAV${Date.now() % 100000}`,
          description: 'Nav Linked',
          syncedAt: new Date(),
        },
      });
      await testContext.prisma.brand.update({
        where: { id: testBrand.id },
        data: { navBrandId: navBrand.navCode },
      });

      const caller = brandRouter.createCaller(testContext);

      await expect(
        caller.hardDelete({ id: testBrand.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('should allow hardDelete if brand is not referenced', async () => {
      // Test: hardDelete dovrebbe riuscire
      const caller = brandRouter.createCaller(testContext);

      const result = await caller.hardDelete({ id: testBrand.id });

      expect(result).toEqual({ success: true });

      // Verifica che il brand sia stato eliminato
      const deletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });

      expect(deletedBrand).toBeNull();
    });

    it('should throw NOT_FOUND for non-existent brand', async () => {
      const caller = brandRouter.createCaller(testContext);
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
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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

      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);
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
      const caller = brandRouter.createCaller(testContext);

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

      const caller = brandRouter.createCaller(testContext);

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

      const caller = brandRouter.createCaller(testContext);

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

      const caller = brandRouter.createCaller(testContext);

      const activeBrands = await caller.list({ isActive: true });
      const inactiveBrands = await caller.list({ isActive: false });

      expect(activeBrands.items).toHaveLength(1);
      expect(inactiveBrands.items).toHaveLength(1);
    });

    it('should handle empty search results', async () => {
      const caller = brandRouter.createCaller(testContext);

      const result = await caller.list({ search: 'NONEXISTENT' });

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should reject limits outside the 1-100 range', async () => {
      const caller = brandRouter.createCaller(testContext);

      // `BrandListInputSchema` vincola limit a [1, 100]: valori fuori range sono
      // rifiutati dalla validazione, non silenziosamente normalizzati.
      await expect(caller.list({ limit: 0 })).rejects.toThrow();
      await expect(caller.list({ limit: 1000 })).rejects.toThrow();
    });

    it('should accept the maximum allowed limit', async () => {
      const caller = brandRouter.createCaller(testContext);

      const result = await caller.list({ limit: 100 });
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('normalizeCode edge cases', () => {
    it('should handle special characters in code normalization', async () => {
      const caller = brandRouter.createCaller(testContext);

      // `BrandInputSchema` ammette solo `[A-Za-z0-9_-]`. La normalizzazione porta
      // in maiuscolo, non ripulisce: i caratteri fuori charset vanno rifiutati.
      // Massimo 20 caratteri: le fixture restano corte apposta.
      const accepted = [
        { input: 'brand-dashes', expected: 'BRAND-DASHES' },
        { input: 'brand_under', expected: 'BRAND_UNDER' },
        { input: 'BRAND123', expected: 'BRAND123' },
      ];

      for (const testCase of accepted) {
        const result = await caller.create({
          code: testCase.input,
          name: `Test Brand ${testCase.input}`,
          isActive: true,
        });
        expect(result.code).toBe(testCase.expected);

        // Cleanup per il prossimo caso
        await testContext.prisma.brand.delete({ where: { id: result.id } });
      }

      const rejected = ['test@brand#1', 'brand.with.dots', 'brand with spaces'];

      for (const code of rejected) {
        await expect(
          caller.create({ code, name: `Test Brand ${code}`, isActive: true })
        ).rejects.toThrow();
      }
    });

    it('should reject non-ASCII characters in code', async () => {
      const caller = brandRouter.createCaller(testContext);

      // `é` è fuori dal charset `[A-Za-z0-9_-]`. Il codice brand finisce in NAV
      // come nvarchar(20): ammettere accenti qui creerebbe drift col gestionale.
      await expect(
        caller.create({ code: 'café-brand', name: 'Café Brand', isActive: true })
      ).rejects.toThrow();
    });
  });

  describe('concurrency tests', () => {
    it('should handle concurrent brand creation with same code', async () => {
      const caller = brandRouter.createCaller(testContext);

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

      // Discriminare per `instanceof TRPCError`, non per la presenza di `.code`:
      // anche un brand creato con successo ha un campo `code` (il codice brand).
      const successes = results.filter(r => !(r instanceof TRPCError));
      const conflicts = results.filter(
        r => r instanceof TRPCError && r.code === 'CONFLICT'
      );

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });

    it('should handle concurrent updates to same brand', async () => {
      const caller = brandRouter.createCaller(testContext);

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
      const successes = results.filter(r => !(r instanceof TRPCError));
      expect(successes).toHaveLength(3);
    });
  });

  describe('soft delete vs hard delete', () => {
    it('should implement soft delete correctly', async () => {
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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

      expect(result).toEqual({ success: true });

      // Verifica che il brand sia completamente rimosso dal DB
      const deletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: brandToHardDelete.id },
      });

      expect(deletedBrand).toBeNull();
    });
  });

  describe('edge cases and error handling', () => {
    it('should reject brand names over the 128 character limit', async () => {
      const caller = brandRouter.createCaller(testContext);

      // 128 è il massimo: al limite passa, oltre viene rifiutato.
      const atLimit = 'A'.repeat(128);
      const result = await caller.create({
        code: 'LONG_NAME_OK',
        name: atLimit,
        isActive: true,
      });
      expect(result.name).toBe(atLimit);

      await expect(
        caller.create({
          code: 'LONG_NAME_KO',
          name: 'A'.repeat(129),
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it('should handle empty string inputs gracefully', async () => {
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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
        const caller = brandRouter.createCaller(adminContext);
        const result = await caller.list();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });

      it('should allow editor to list brands', async () => {
        const caller = brandRouter.createCaller(editorContext);
        const result = await caller.list();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });

      it('should allow viewer to list brands', async () => {
        const caller = brandRouter.createCaller(viewerContext);
        const result = await caller.list();
        expect(result.items).toBeDefined();
        expect(Array.isArray(result.items)).toBe(true);
      });
    });

    describe('create operation', () => {
      it('should allow admin to create brands', async () => {
        const caller = brandRouter.createCaller(adminContext);
        const result = await caller.create({
          code: 'ADMIN_BRAND',
          name: 'Admin Brand',
          isActive: true,
        });
        expect(result.id).toBeDefined();
        expect(result.code).toBe('ADMIN_BRAND');
      });

      it('should allow editor to create brands', async () => {
        const caller = brandRouter.createCaller(editorContext);
        const result = await caller.create({
          code: 'EDITOR_BRAND',
          name: 'Editor Brand',
          isActive: true,
        });
        expect(result.id).toBeDefined();
        expect(result.code).toBe('EDITOR_BRAND');
      });

      it('should deny viewer from creating brands', async () => {
        const caller = brandRouter.createCaller(viewerContext);
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
        const caller = brandRouter.createCaller(adminContext);
        const result = await caller.update({
          id: testBrand.id,
          data: {
            name: 'Updated by Admin',
          },
        });
        expect(result.name).toBe('Updated by Admin');
      });

      it('should allow editor to update brands', async () => {
        const caller = brandRouter.createCaller(editorContext);
        const result = await caller.update({
          id: testBrand.id,
          data: {
            name: 'Updated by Editor',
          },
        });
        expect(result.name).toBe('Updated by Editor');
      });

      it('should deny viewer from updating brands', async () => {
        const caller = brandRouter.createCaller(viewerContext);
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
        const caller = brandRouter.createCaller(adminContext);
        const result = await caller.hardDelete({ id: testBrand.id });
        expect(result).toEqual({ success: true });
      });

      it('should allow editor to hard delete brands', async () => {
        const caller = brandRouter.createCaller(editorContext);
        const result = await caller.hardDelete({ id: testBrand.id });
        expect(result).toEqual({ success: true });
      });

      it('should deny viewer from hard deleting brands', async () => {
        const caller = brandRouter.createCaller(viewerContext);
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

        const caller = brandRouter.createCaller(unauthenticatedContext);

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
