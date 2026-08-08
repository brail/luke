/**
 * Tests for the Brand Router.
 *
 * Exercises the **real** path: `appRouter.createCaller(ctx).brand`. The
 * previous version reimplemented a local copy of it (`testBrandRouter`) to
 * work around the rate limit: a copy, however, is not the production code, and in fact
 * it had fallen behind on `logoUrl`->`logoKey`, on the `hardDelete`
 * preconditions, and on `UserPreference.lastBrandId` (today inside the JSON
 * blob `data`). A test that verifies a copy says nothing about what actually runs in production.
 *
 * The same argument holds one level up, and is why this file does not
 * use `brandRouter.createCaller`: `router({ brand: brandRouter })` does not preserve
 * the original router, it rebuilds an aggregate. Calling the sub-router
 * therefore skips the composition that production actually goes through -- and it is
 * invisible to the coverage gate, which measures invocations on `appRouter`.
 *
 * The rate limit is neutralized by resetting the store between tests -- which
 * `test/setup.ts` does for all specs -- not by duplicating the router.
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
    // `createContextForRole` truncates with CASCADE before inserting the session
    // user: this is needed because the tests also create season, collection layout, and nav
    // brand, and a selective delete on `brand` runs into foreign keys,
    // leaving the database dirty for the next test.
    testContext = await createContextForRole();

    // Create a test brand
    testBrand = await testContext.prisma.brand.create({
      data: {
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      },
    });
  });

  describe('hardDelete', () => {
    // The preconditions of hardDelete have changed: it is no longer the reference in
    // `UserPreference` that blocks it (that field now lives inside the JSON blob `data`, no
    // longer as the `lastBrandId` column), but the link to NAV and the brand's use
    // in a collection layout or pricing set.
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
      // Test: hardDelete should succeed
      const caller = appRouter.createCaller(testContext).brand;

      const result = await caller.hardDelete({ id: testBrand.id });

      expect(result).toEqual({ success: true });

      // Verify that the brand was deleted
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
        code: 'new-brand', // Code with lowercase letters and dashes
        name: 'New Brand',
        isActive: true,
      };

      const result = await caller.create(brandData);

      expect(result).toMatchObject({
        code: 'NEW-BRAND', // Should be normalized
        name: 'New Brand',
        isActive: true,
      });
      expect(result.id).toBeDefined();
    });

    it('should reject duplicate brand code', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      const brandData = {
        code: 'TEST_BRAND', // Same code as the existing brand
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
        code: 'test_brand', // Underscore that is preserved by normalization
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
        code: 'invalid-code!', // Invalid characters
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
          code: 'updated-brand', // Code with lowercase letters and dashes
        },
      };

      const result = await caller.update(updateData);

      expect(result).toMatchObject({
        id: testBrand.id,
        code: 'UPDATED-BRAND', // Should be normalized
      });
    });

    it('should reject update with duplicate code', async () => {
      // Create a second brand to test code conflict
      const secondBrand = await testContext.prisma.brand.create({
        data: {
          code: 'SECOND_BRAND',
          name: 'Second Brand',
          isActive: true,
        },
      });

      // Verify that the second brand was created correctly
      expect(secondBrand.code).toBe('SECOND_BRAND');

      const caller = appRouter.createCaller(testContext).brand;

      const updateData = {
        id: testBrand.id,
        data: {
          code: 'SECOND_BRAND', // Code that already exists
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
      // Create more brands to test pagination
      const brands = [];
      for (let i = 0; i < 2; i++) {
        // Only 2 additional brands
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

      // First page
      const firstPage = await caller.list({ limit: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).toBeDefined();

      // Second page using cursor
      const secondPage = await caller.list({
        cursor: firstPage.nextCursor!,
        limit: 2,
      });
      // There should be 1 element left (the original testBrand)
      expect(secondPage.items.length).toBeGreaterThanOrEqual(1);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.nextCursor).toBeNull();
    });

    it('should filter brands by search term', async () => {
      // Create a second brand
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
      // Create an inactive brand
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

      // `BrandListInputSchema` constrains limit to [1, 100]: out-of-range values are
      // rejected by validation, not silently normalized.
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

      // `BrandInputSchema` only allows `[A-Za-z0-9_-]`. Normalization uppercases
      // it, it does not clean it up: characters outside the charset must be rejected.
      // Maximum 20 characters: the fixtures are kept short on purpose.
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

        // Cleanup for the next case
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

      // `é` is outside the `[A-Za-z0-9_-]` charset. The brand code ends up in NAV
      // as nvarchar(20): allowing accents here would create drift with the ERP.
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

      // Simulates concurrent creation
      const promises = Array.from({ length: 3 }, () =>
        caller.create(brandData).catch(error => error)
      );

      const results = await Promise.all(promises);

      // Discriminate by `instanceof TRPCError`, not by the presence of `.code`:
      // even a brand created successfully has a `code` field (the brand code).
      const successes = results.filter(r => !(r instanceof TRPCError));
      const conflicts = results.filter(
        r => r instanceof TRPCError && r.code === 'CONFLICT'
      );

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });

    it('should handle concurrent updates to same brand', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      // Create a second brand to test concurrent update
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

      // All should succeed (update has no code conflicts)
      const successes = results.filter(r => !(r instanceof TRPCError));
      expect(successes).toHaveLength(3);
    });
  });

  describe('soft delete vs hard delete', () => {
    it('should implement soft delete correctly', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      // Create a brand for soft delete
      const brandToSoftDelete = await testContext.prisma.brand.create({
        data: {
          code: 'SOFT_DELETE_TEST',
          name: 'Soft Delete Test',
          isActive: true,
        },
      });

      // Soft delete (remove) - not implemented in the test router, but we test the behavior
      // Simulate soft delete directly in the DB
      await testContext.prisma.brand.update({
        where: { id: brandToSoftDelete.id },
        data: { isActive: false },
      });

      // Verify the brand is still in the DB but inactive
      const softDeletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: brandToSoftDelete.id },
      });

      expect(softDeletedBrand).toBeDefined();
      expect(softDeletedBrand?.isActive).toBe(false);

      // Verify it doesn't appear in active lists
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

      // Create a brand for hard delete
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

      // Verify the brand was completely removed from the DB
      const deletedBrand = await testContext.prisma.brand.findUnique({
        where: { id: brandToHardDelete.id },
      });

      expect(deletedBrand).toBeNull();
    });
  });

  describe('edge cases and error handling', () => {
    it('should reject brand names over the 128 character limit', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      // 128 is the maximum: at the limit it passes, beyond it it's rejected.
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

      // Test with empty name
      await expect(
        caller.create({
          code: 'EMPTY_NAME_TEST',
          name: '',
          isActive: true,
        })
      ).rejects.toThrow();

      // Test with empty code
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

      // Test with null values
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

    /** `brand` caller per role; `null` means no session. */
    function brandAs(role: Role | null): BrandCaller {
      const ctx = role ? contexts[role] : { ...testContext, session: null };
      return appRouter.createCaller(ctx).brand;
    }

    /**
     * The router's four operations with valid input.
     *
     * They're a table because every denial has to be verified against all of
     * them: written by hand, `viewer` and "not authenticated" were seven
     * blocks repeating the same input, and each one invoked the procedure
     * **twice** — once for `rejects.toThrow(TRPCError)` and once to reread
     * `.code` from the `catch`.
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

    /** Mutations: everything except `list`. */
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
