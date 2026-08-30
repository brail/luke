/**
 * Contratto di `getPasswordPolicy`: come le cinque chiavi `security.password.*` di AppConfig
 * diventano la policy che il server applica.
 *
 * Nessun test la copriva. Sta per diventare l'autorità su quattro percorsi che impostano una
 * password invece di uno solo, quindi cosa legge — e cosa succede quando una chiave manca o è
 * scritta male — smette di essere un dettaglio.
 *
 * Integration perché legge da AppConfig; la validazione vera e propria è pura e sta in
 * `password.spec.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { getPasswordPolicy } from '../src/lib/configManager';

import { resetTestData, setupTestDb } from './helpers';

import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  await resetTestData();
});

/** Scrive solo le chiavi passate, così ogni test dichiara da cosa dipende. */
async function seedPolicy(values: Record<string, string>): Promise<void> {
  await prisma.appConfig.createMany({
    data: Object.entries(values).map(([key, value]) => ({ key, value, isEncrypted: false })),
  });
}

describe('getPasswordPolicy — cosa legge', () => {
  it('senza alcuna chiave torna il default sicuro: tutto acceso, 12 caratteri', () => {
    // Il fallback vive in un `.catch()` per chiave: `getTypedConfig` lancia se la chiave manca.
    // Il default deve essere il più severo, non il più permissivo.
    return expect(getPasswordPolicy(prisma)).resolves.toEqual({
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSpecialChar: true,
    });
  });

  it('legge minLength dalla configurazione', async () => {
    await seedPolicy({ 'security.password.minLength': '16' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 16 });
  });

  it('clampa minLength a 8 quando la configurazione dice meno', async () => {
    await seedPolicy({ 'security.password.minLength': '7' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 8 });
  });

  it('sotto il pavimento del registry non clampa: ricade sul default, che è più severo', async () => {
    // Il pavimento è dichiarato due volte e in disaccordo: `AppConfigRegistry` dice 6, il clamp
    // dice 8. Un valore sotto 6 non passa il registry, quindi `getTypedConfig` lancia e il
    // `.catch()` restituisce 12 — chiedere 4 dà 12, chiedere 7 dà 8. Fissato perché è la
    // conseguenza osservabile della contraddizione, non perché sia un comportamento desiderabile.
    await seedPolicy({ 'security.password.minLength': '4' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 12 });
  });

  it('una chiave illeggibile non rompe la policy, ricade sul default', async () => {
    await seedPolicy({ 'security.password.minLength': 'non-un-numero' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 12 });
  });
});

/**
 * I quattro interruttori devono potersi spegnere.
 *
 * Una policy configurabile che sa solo diventare più severa non è configurabile: è una costante
 * con un pannello di controllo. E finché `validatePassword` aveva un solo call site il difetto
 * restava piccolo — estendendolo a quattro percorsi, un requisito che non si può togliere diventa
 * un lockout.
 */
describe('getPasswordPolicy — spegnere un requisito lo spegne davvero', () => {
  const toggles = [
    'requireUppercase',
    'requireLowercase',
    'requireDigit',
    'requireSpecialChar',
  ] as const;

  for (const toggle of toggles) {
    it(`${toggle} = "false" disattiva il requisito`, async () => {
      await seedPolicy({ [`security.password.${toggle}`]: 'false' });
      await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ [toggle]: false });
    });

    it(`${toggle} = "true" lo lascia acceso`, async () => {
      await seedPolicy({ [`security.password.${toggle}`]: 'true' });
      await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ [toggle]: true });
    });
  }
});
