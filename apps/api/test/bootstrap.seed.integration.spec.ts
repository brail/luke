/**
 * Test to validate the idempotency and functionality of the seed
 *
 * Verifies:
 * - seedAdminUser creates admin if it doesn't exist
 * - seedAdminUser is idempotent (no duplication)
 * - seedAppConfigs creates base configurations
 * - seedAppConfigs is idempotent (no duplication)
 * - No LDAP configuration in the seed
 * - seedContextData creates a usable brand, season, and pricing parameter set
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { PrismaClient } from '@luke/db';

import { seedAdminUser, seedAppConfigs, seedContextData } from '../prisma/seed';
import { calculateForward } from '../src/services/pricing.service';

import { setupTestDb } from './helpers/database';

describe('Bootstrap & Seed', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  beforeEach(async () => {
    // Clean the database before each test
    await prisma.localCredential.deleteMany();
    await prisma.identity.deleteMany();
    await prisma.user.deleteMany();
    await prisma.appConfig.deleteMany();
  });

  it('seedAdminUser crea admin se non esiste', async () => {
    await seedAdminUser(prisma);

    const admin = await prisma.user.findFirst({
      where: { username: 'admin' },
      include: {
        identities: {
          include: {
            localCredential: true,
          },
        },
      },
    });

    expect(admin).toBeTruthy();
    expect(admin?.email).toBe('admin@luke.local');
    expect(admin?.role).toBe('admin');
    expect(admin?.isActive).toBe(true);
    expect(admin?.identities).toHaveLength(1);
    expect(admin?.identities[0].provider).toBe('LOCAL');
    expect(admin?.identities[0].localCredential).toBeTruthy();
  });

  it('seedAdminUser è idempotente', async () => {
    // First run
    await seedAdminUser(prisma);
    const count1 = await prisma.user.count();
    const admin1 = await prisma.user.findFirst({
      where: { username: 'admin' },
    });

    // Second run
    await seedAdminUser(prisma);
    const count2 = await prisma.user.count();
    const admin2 = await prisma.user.findFirst({
      where: { username: 'admin' },
    });

    expect(count2).toBe(count1); // No duplication
    expect(admin1?.id).toBe(admin2?.id); // Same user
  });

  it('seedAppConfigs crea configurazioni base', async () => {
    await seedAppConfigs(prisma);

    const [nextAuthSecret, appName, passwordMinLength, authStrategy] =
      await Promise.all([
        prisma.appConfig.findUnique({ where: { key: 'auth.nextAuthSecret' } }),
        prisma.appConfig.findUnique({ where: { key: 'app.name' } }),
        prisma.appConfig.findUnique({
          where: { key: 'security.password.minLength' },
        }),
        prisma.appConfig.findUnique({ where: { key: 'auth.strategy' } }),
      ]);

    expect(nextAuthSecret).toBeTruthy();
    expect(nextAuthSecret?.isEncrypted).toBe(true);
    expect(appName?.value).toBe('Luke');
    expect(passwordMinLength?.value).toBe('12');
    expect(authStrategy?.value).toBe('local-first');
  });

  it('seedAppConfigs è idempotente', async () => {
    // First run
    await seedAppConfigs(prisma);
    const count1 = await prisma.appConfig.count();

    // Second run
    await seedAppConfigs(prisma);
    const count2 = await prisma.appConfig.count();

    expect(count2).toBe(count1); // No duplication
  });

  it('nessuna configurazione LDAP nel seed', async () => {
    await seedAppConfigs(prisma);

    const ldapConfigs = await prisma.appConfig.findMany({
      where: { key: { startsWith: 'auth.ldap.' } },
    });

    expect(ldapConfigs.length).toBe(0);
  });

  it('configurazioni critiche sono presenti', async () => {
    await seedAppConfigs(prisma);

    const criticalKeys = [
      'auth.nextAuthSecret',
      'app.name',
      'security.password.minLength',
      'auth.strategy',
      'app.locale',
      'app.defaultTimezone',
    ];

    const configs = await prisma.appConfig.findMany({
      where: { key: { in: criticalKeys } },
    });

    expect(configs).toHaveLength(criticalKeys.length);

    // Verify specific values
    const appName = configs.find(c => c.key === 'app.name');
    const authStrategy = configs.find(c => c.key === 'auth.strategy');
    const locale = configs.find(c => c.key === 'app.locale');

    expect(appName?.value).toBe('Luke');
    expect(authStrategy?.value).toBe('local-first');
    expect(locale?.value).toBe('it-IT');
  });

  it('rateLimit è un JSON valido', async () => {
    await seedAppConfigs(prisma);

    const rateLimitConfig = await prisma.appConfig.findUnique({
      where: { key: 'rateLimit' },
    });

    expect(rateLimitConfig).toBeTruthy();
    expect(rateLimitConfig?.isEncrypted).toBe(false);

    const rateLimit = JSON.parse(rateLimitConfig!.value);
    expect(rateLimit).toHaveProperty('login');
    expect(rateLimit).toHaveProperty('passwordChange');
    expect(rateLimit).toHaveProperty('configMutations');
    expect(rateLimit).toHaveProperty('userMutations');

    expect(rateLimit.login).toEqual({ max: 5, timeWindow: '1m', keyBy: 'ip' });
  });

  /**
   * `seedContextData` wasn't covered by anything, and the seed had already broken
   * once silently (an `isMain` field left behind after its removal from the
   * schema): a fresh install failed with no test to say so.
   */
  describe('seedContextData', () => {
    beforeEach(async () => {
      await prisma.pricingParameterSet.deleteMany();
      await prisma.brand.deleteMany();
      await prisma.season.deleteMany();
    });

    it('crea brand, stagione e set parametri pricing', async () => {
      await seedContextData(prisma);

      const brand = await prisma.brand.findUnique({ where: { code: 'ACME' } });
      const season = await prisma.season.findUnique({ where: { code: 'PE00' } });
      expect(brand?.isActive).toBe(true);
      expect(season?.isActive).toBe(true);

      // The parameter set is the precondition for the calculator: without it, the
      // Costi e Prezzi page shows the empty state and the E2E smoke test skips the
      // calculation instead of verifying it.
      const sets = await prisma.pricingParameterSet.findMany();
      expect(sets).toHaveLength(1);
      expect(sets[0]).toMatchObject({
        brandId: brand!.id,
        seasonId: season!.id,
        isDefault: true,
      });
    });

    it('è idempotente', async () => {
      await seedContextData(prisma);
      await seedContextData(prisma);

      expect(await prisma.brand.count()).toBe(1);
      expect(await prisma.season.count()).toBe(1);
      expect(await prisma.pricingParameterSet.count()).toBe(1);
    });

    it('il set parametri produce un calcolo forward coerente', async () => {
      await seedContextData(prisma);
      const set = await prisma.pricingParameterSet.findFirstOrThrow();

      const result = calculateForward(100, set);

      // Doesn't assert the exact number — that would be a tautological test of the
      // formula. Asserts the two properties that make the seed *usable*: retail
      // exceeds the purchase cost, and the margin hits the declared target. A set
      // with inconsistent values would still pass the two tests above and would
      // only break the smoke test, downstream.
      expect(result.retailPrice).toBeGreaterThan(100);
      expect(result.companyMargin * 100).toBeCloseTo(set.optimalMargin, 1);
    });
  });
});
