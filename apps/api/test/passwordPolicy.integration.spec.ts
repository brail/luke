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

import { createAnonymousCaller, resetTestData, setupTestDb } from './helpers';

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

  it('accetta il pavimento esatto', async () => {
    await seedPolicy({ 'security.password.minLength': '8' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 8 });
  });

  for (const below of ['7', '4']) {
    it(`sotto il pavimento (${below}) ricade sul default, che è più severo`, async () => {
      // Un pavimento solo, dichiarato nel registry: un valore che non lo rispetta non parsa, e il
      // `.catch()` restituisce il default. Prima erano tre numeri per una regola e la risposta
      // dipendeva da quanto si scendeva — 7 diventava 8, 4 diventava 12.
      await seedPolicy({ 'security.password.minLength': below });
      await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 12 });
    });
  }

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

/**
 * La policy deve essere leggibile senza sessione.
 *
 * La pagina di reset vive fuori dal layout autenticato — chi imposta una nuova password non ha una
 * sessione, per definizione — ed è la pagina che ne aveva più bisogno: annunciava un minimo scritto
 * a mano, non mostrava alcun requisito di complessità, e poi rilanciava un rifiuto del server che
 * ne elencava altri di cui non aveva mai parlato.
 */
describe('public.passwordPolicy', () => {
  it('risponde a un client anonimo', async () => {
    const anon = await createAnonymousCaller();
    await expect(anon.public.passwordPolicy()).resolves.toMatchObject({
      minLength: 12,
      requireUppercase: true,
    });
  });

  it('riflette la configurazione, non un default compilato', async () => {
    await seedPolicy({
      'security.password.minLength': '16',
      'security.password.requireSpecialChar': 'false',
    });
    const anon = await createAnonymousCaller();
    await expect(anon.public.passwordPolicy()).resolves.toMatchObject({
      minLength: 16,
      requireSpecialChar: false,
    });
  });

  it('nomina i caratteri che contano come speciali', async () => {
    // Il client non può dire «un simbolo»: la classe del server è un allowlist, e `~` o uno spazio
    // sembrano accettabili sotto un'etichetta vaga fino al rifiuto.
    const anon = await createAnonymousCaller();
    const policy = await anon.public.passwordPolicy();
    expect(policy.specialChars).toContain('!');
    expect(policy.specialChars).not.toContain('~');
  });
});
