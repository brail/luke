/**
 * Test del Brand Router.
 *
 * Esercita il percorso **reale**: `appRouter.createCaller(ctx).brand`. La
 * versione precedente ne reimplementava una copia locale (`testBrandRouter`) per
 * aggirare il rate limit: una copia però non è il codice di produzione, e infatti
 * era rimasta indietro su `logoUrl`→`logoKey`, sulle precondizioni di
 * `hardDelete` e su `UserPreference.lastBrandId` (oggi dentro il blob JSON
 * `data`). Un test che verifica una copia non dice nulla su ciò che gira davvero.
 *
 * Lo stesso argomento vale un gradino più su, ed è il motivo per cui qui non si
 * usa `brandRouter.createCaller`: `router({ brand: brandRouter })` non conserva
 * il router originale, ne ricostruisce un aggregato. Chiamare il sotto-router
 * salta quindi la composizione che la produzione attraversa davvero — ed è
 * invisibile al gate di copertura, che misura le invocazioni su `appRouter`.
 *
 * Il rate limit si neutralizza azzerando lo store fra i test — cosa che fa
 * `test/setup.ts` per tutte le spec — non duplicando il router.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach } from 'vitest';

import { appRouter } from '../src/routers/index';

import { expectUnauthorized } from './helpers';
import { createContextForRole } from './helpers/testContext';

describe('Brand Router', () => {
  let testContext: any;
  let testBrand: any;

  beforeEach(async () => {
    // `createContextForRole` tronca con CASCADE prima di inserire l'utente di
    // sessione: serve perché i test creano anche season, collection layout e nav
    // brand, e un delete selettivo su `brand` sbatte contro le foreign key
    // lasciando il database sporco per il test dopo.
    testContext = await createContextForRole();

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

      const caller = appRouter.createCaller(testContext).brand;

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

      const caller = appRouter.createCaller(testContext).brand;

      await expect(
        caller.hardDelete({ id: testBrand.id })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('should allow hardDelete if brand is not referenced', async () => {
      // Test: hardDelete dovrebbe riuscire
      const caller = appRouter.createCaller(testContext).brand;

      const result = await caller.hardDelete({ id: testBrand.id });

      expect(result).toEqual({ success: true });

      // Verifica che il brand sia stato eliminato
      const deletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });

      expect(deletedBrand).toBeNull();
    });

    it('should throw NOT_FOUND for non-existent brand', async () => {
      const caller = appRouter.createCaller(testContext).brand;
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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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

      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;
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
      const caller = appRouter.createCaller(testContext).brand;

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

      const caller = appRouter.createCaller(testContext).brand;

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

      const caller = appRouter.createCaller(testContext).brand;

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

      const caller = appRouter.createCaller(testContext).brand;

      const activeBrands = await caller.list({ isActive: true });
      const inactiveBrands = await caller.list({ isActive: false });

      expect(activeBrands.items).toHaveLength(1);
      expect(inactiveBrands.items).toHaveLength(1);
    });

    it('should handle empty search results', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      const result = await caller.list({ search: 'NONEXISTENT' });

      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should reject limits outside the 1-100 range', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      // `BrandListInputSchema` vincola limit a [1, 100]: valori fuori range sono
      // rifiutati dalla validazione, non silenziosamente normalizzati.
      await expect(caller.list({ limit: 0 })).rejects.toThrow();
      await expect(caller.list({ limit: 1000 })).rejects.toThrow();
    });

    it('should accept the maximum allowed limit', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      const result = await caller.list({ limit: 100 });
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('normalizeCode edge cases', () => {
    it('should handle special characters in code normalization', async () => {
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

      // `é` è fuori dal charset `[A-Za-z0-9_-]`. Il codice brand finisce in NAV
      // come nvarchar(20): ammettere accenti qui creerebbe drift col gestionale.
      await expect(
        caller.create({ code: 'café-brand', name: 'Café Brand', isActive: true })
      ).rejects.toThrow();
    });
  });

  describe('concurrency tests', () => {
    it('should handle concurrent brand creation with same code', async () => {
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
      const caller = appRouter.createCaller(testContext).brand;

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
    type Role = 'admin' | 'editor' | 'viewer';
    type BrandCaller = ReturnType<typeof appRouter.createCaller>['brand'];

    const ROLES: Role[] = ['admin', 'editor', 'viewer'];
    const contexts = {} as Record<Role, any>;

    beforeEach(async () => {
      const created = await Promise.all(
        ROLES.map(role =>
          testContext.prisma.user.create({
            data: {
              email: `${role}@example.com`,
              username: role,
              firstName: role.charAt(0).toUpperCase() + role.slice(1),
              lastName: 'User',
              role,
            },
          })
        )
      );

      ROLES.forEach((role, i) => {
        contexts[role] = {
          ...testContext,
          session: { user: created[i], accessToken: `${role}-token` },
        };
      });
    });

    /** Caller `brand` per ruolo; `null` significa nessuna sessione. */
    function brandAs(role: Role | null): BrandCaller {
      const ctx = role ? contexts[role] : { ...testContext, session: null };
      return appRouter.createCaller(ctx).brand;
    }

    /**
     * Le quattro operazioni del router con input validi.
     *
     * Sono una tabella perché ogni negazione va verificata su tutte: scritte a
     * mano, `viewer` e "non autenticato" erano sette blocchi che ripetevano lo
     * stesso input, e ognuno invocava la procedura **due volte** — una per
     * `rejects.toThrow(TRPCError)` e una per rileggere `.code` dal `catch`.
     */
    const OPERATIONS: [string, (caller: BrandCaller) => Promise<unknown>][] = [
      ['list', c => c.list()],
      [
        'create',
        c => c.create({ code: 'RBAC_BRAND', name: 'RBAC Brand', isActive: true }),
      ],
      ['update', c => c.update({ id: testBrand.id, data: { name: 'Updated' } })],
      ['hardDelete', c => c.hardDelete({ id: testBrand.id })],
    ];

    /** Mutazioni: tutto tranne `list`. */
    const MUTATIONS = OPERATIONS.slice(1);

    it.each(ROLES)('%s può listare i brand', async role => {
      const result = await brandAs(role).list();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it.each(['admin', 'editor'] as Role[])(
      '%s può creare un brand',
      async role => {
        const code = `${role.toUpperCase()}_BRAND`;
        const result = await brandAs(role).create({
          code,
          name: `${role} Brand`,
          isActive: true,
        });
        expect(result.id).toBeDefined();
        expect(result.code).toBe(code);
      }
    );

    it.each(['admin', 'editor'] as Role[])(
      '%s può aggiornare un brand',
      async role => {
        const name = `Updated by ${role}`;
        const result = await brandAs(role).update({
          id: testBrand.id,
          data: { name },
        });
        expect(result.name).toBe(name);
      }
    );

    it.each(['admin', 'editor'] as Role[])(
      '%s può cancellare definitivamente un brand',
      async role => {
        await expect(
          brandAs(role).hardDelete({ id: testBrand.id })
        ).resolves.toEqual({ success: true });
      }
    );

    it.each(MUTATIONS)('viewer: %s → FORBIDDEN', async (_label, invoke) => {
      await expectUnauthorized(() => invoke(brandAs('viewer')), 'FORBIDDEN');
    });

    it.each(OPERATIONS)(
      'non autenticato: %s → UNAUTHORIZED',
      async (_label, invoke) => {
        await expectUnauthorized(() => invoke(brandAs(null)), 'UNAUTHORIZED');
      }
    );
  });
});
