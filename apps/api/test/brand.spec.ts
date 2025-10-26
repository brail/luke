/**
 * Test unitari per Brand Router
 * Verifica CRUD operations e integrità referenziale
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TRPCError } from '@trpc/server';

import { brandRouter } from '../src/routers/brand';
import { createTestContext } from './helpers/testContext';

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
      const caller = brandRouter.createCaller(testContext);

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
      const caller = brandRouter.createCaller(testContext);

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
    it('should create brand with valid data', async () => {
      const caller = brandRouter.createCaller(testContext);

      const brandData = {
        code: 'NEW_BRAND',
        name: 'New Brand',
        isActive: true,
      };

      const result = await caller.create(brandData);

      expect(result).toMatchObject({
        code: 'NEW_BRAND',
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

    it('should reject update with duplicate code', async () => {
      // Crea un secondo brand
      const secondBrand = await testContext.prisma.brand.create({
        data: {
          code: 'SECOND_BRAND',
          name: 'Second Brand',
          isActive: true,
        },
      });

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
  });

  describe('list', () => {
    it('should list all brands', async () => {
      const caller = brandRouter.createCaller(testContext);

      const result = await caller.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: testBrand.id,
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      });
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

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('NIKE');
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

      expect(activeBrands).toHaveLength(1);
      expect(inactiveBrands).toHaveLength(1);
    });
  });
});
