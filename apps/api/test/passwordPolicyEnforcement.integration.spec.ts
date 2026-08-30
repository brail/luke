/**
 * La policy password configurata in AppConfig governa **tutti** i percorsi che impostano una
 * password, non solo la conferma del reset.
 *
 * È il difetto che questo batch chiude, ed era di quelli che non si vedono: cinque chiavi
 * `security.password.*` esistevano, erano validate e leggibili, e `validatePassword` aveva un solo
 * call site. Alzare `minLength` a 16 lasciava la creazione utente accettare 12; spegnere un
 * requisito lasciava il cambio password self-service rifiutare comunque. Falliva aperto in una
 * direzione e chiuso nell'altra, e ogni percorso era coerente con sé stesso.
 *
 * Ogni test qui configura la policy e poi guarda il verdetto cambiare: è l'unica forma che
 * distingue «la regola è applicata» da «la regola è scritta uguale in un altro posto».
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  TEST_USER_PASSWORD,
  createCallerWithSession,
  createTestUser,
  resetTestData,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
let adminSession: UserSession;

/** Dodici caratteri, minuscole e cifre: passa il prefiltro statico, non la complessità di default. */
const NO_UPPERCASE = 'passw0rd!123';
/** Dodici caratteri che soddisfano ogni requisito acceso. */
const STRONG = 'TestPassw1rd!x';

beforeEach(async () => {
  prisma = await setupTestDb();
  await resetTestData();
  const admin = await createTestUser('admin');
  adminSession = admin.session;
});

const asAdmin = () => createCallerWithSession(adminSession);

async function setPolicy(values: Record<string, string>): Promise<void> {
  await prisma.appConfig.createMany({
    data: Object.entries(values).map(([key, value]) => ({ key, value, isEncrypted: false })),
  });
}

const newUser = () => {
  const uid = randomUUID().slice(0, 8);
  return { email: `u${uid}@example.com`, username: `u${uid}`, role: 'viewer' as const };
};

describe('users.core.create', () => {
  it('rifiuta una password che non soddisfa la complessità configurata', async () => {
    await expect(
      asAdmin().users.create({ ...newUser(), password: NO_UPPERCASE })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('la accetta se quel requisito viene spento', async () => {
    // Il senso della configurazione: spegnerlo deve spegnerlo anche qui, non solo sul reset.
    await setPolicy({ 'security.password.requireUppercase': 'false' });
    await expect(
      asAdmin().users.create({ ...newUser(), password: NO_UPPERCASE })
    ).resolves.toMatchObject({ username: expect.any(String) });
  });

  it('alzare minLength rifiuta una password che prima bastava', async () => {
    // Il caso esatto del difetto: prima questa restava accettata perché lo Zod diceva 12 e la
    // configurazione non arrivava fin qui.
    await expect(asAdmin().users.create({ ...newUser(), password: STRONG })).resolves.toBeTruthy();

    await setPolicy({ 'security.password.minLength': '16' });
    await expect(
      asAdmin().users.create({ ...newUser(), password: STRONG })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('users.core.update', () => {
  it('rifiuta una password che non soddisfa la complessità configurata', async () => {
    const { user: target } = await createTestUser('viewer');
    await expect(
      asAdmin().users.update({ id: target.id, password: NO_UPPERCASE })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('la accetta se quel requisito viene spento', async () => {
    const { user: target } = await createTestUser('viewer');
    await setPolicy({ 'security.password.requireUppercase': 'false' });
    await expect(
      asAdmin().users.update({ id: target.id, password: NO_UPPERCASE })
    ).resolves.toMatchObject({ id: target.id });
  });

  it('una update senza password non consulta la policy', async () => {
    // La policy non deve trasformarsi in un ostacolo per chi modifica un altro campo.
    const { user: target } = await createTestUser('viewer');
    await setPolicy({ 'security.password.minLength': '128' });
    await expect(
      asAdmin().users.update({ id: target.id, firstName: 'Nuovo' })
    ).resolves.toMatchObject({ id: target.id });
  });
});

describe('me.changePassword', () => {
  it('rifiuta una password che non soddisfa la complessità configurata', async () => {
    const { session } = await createTestUser('editor');
    await expect(
      createCallerWithSession(session).me.changePassword({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: NO_UPPERCASE,
        confirmNewPassword: NO_UPPERCASE,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('la accetta se quel requisito viene spento', async () => {
    // La direzione che prima falliva chiusa: la catena hardcoded nello schema rifiutava comunque,
    // qualunque cosa dicesse la configurazione.
    const { session } = await createTestUser('editor');
    await setPolicy({ 'security.password.requireUppercase': 'false' });
    await expect(
      createCallerWithSession(session).me.changePassword({
        currentPassword: TEST_USER_PASSWORD,
        newPassword: NO_UPPERCASE,
        confirmNewPassword: NO_UPPERCASE,
      })
    ).resolves.toBeTruthy();
  });
});
