/**
 * The policy configured in AppConfig governs **every** path that sets a password, not only the
 * reset confirmation.
 *
 * This is the defect the batch closes, and it was one of the invisible ones: five
 * `security.password.*` keys existed, validated and readable, while `validatePassword` had a single
 * call site. Raising `minLength` to 16 left user creation accepting 12; switching a requirement off
 * left the self-service change refusing anyway. It failed open in one direction and closed in the
 * other, and each path was self-consistent.
 *
 * Every test here configures the policy and then watches the verdict change. That is the only shape
 * that tells "the rule is applied" apart from "the rule is written the same way somewhere else".
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createResetToken } from '../src/lib/emailHelpers';

import {
  TEST_USER_PASSWORD,
  createAnonymousCaller,
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  resetTestData,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

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
    // The point of configuring it: switching it off must switch it off here too, not only on reset.
    await setPolicy({ 'security.password.requireUppercase': 'false' });
    await expect(
      asAdmin().users.create({ ...newUser(), password: NO_UPPERCASE })
    ).resolves.toMatchObject({ username: expect.any(String) });
  });

  it('alzare minLength rifiuta una password che prima bastava', async () => {
    // The defect exactly: this used to stay accepted, because Zod said 12 and the configuration
    // never reached this far.
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
    // The policy must not become an obstacle to editing some other field.
    const { user: target } = await createTestUser('viewer');
    await setPolicy({ 'security.password.minLength': '128' });
    await expect(
      asAdmin().users.update({ id: target.id, firstName: 'Nuovo' })
    ).resolves.toMatchObject({ id: target.id });
  });
});

/**
 * The reset confirmation — the one path that always consulted the policy, and the one the refactor
 * could not prove it had kept. Neutralising the check here left the whole suite green.
 */
describe('auth.confirmPasswordReset', () => {
  const resetWith = async (newPassword: string) => {
    const { user } = await createTestUser('viewer');
    const { token } = await createResetToken(prisma, user.id);
    const anon = await createAnonymousCaller();
    return anon.auth.confirmPasswordReset({ token, newPassword });
  };

  it('rifiuta una password che non soddisfa la complessità configurata', async () => {
    await expect(resetWith(NO_UPPERCASE)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('la accetta se quel requisito viene spento', async () => {
    await setPolicy({ 'security.password.requireUppercase': 'false' });
    await expect(resetWith(NO_UPPERCASE)).resolves.toBeTruthy();
  });

  it('registra il tentativo debole nell’audit, che è il motivo per cui questo percorso non usa assert', async () => {
    await expect(resetWith(NO_UPPERCASE)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'PASSWORD_CHANGED', result: 'FAILURE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((log?.metadata as { reason?: string } | null)?.reason).toBe('weak_password');
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
    // The direction that used to fail closed: the hardcoded chain in the schema refused anyway,
    // whatever the configuration said.
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

/**
 * Who may change the policy.
 *
 * Making it authoritative over four paths removed the static floors no configuration could lower.
 * If it stays writable by a non-admin role, the net effect is moving the decision from the code to
 * a user who previously could not make it: an editor could have taken it down to eight characters
 * of anything. This is the test that stops the permission coming back.
 */
describe('la policy la cambia solo un admin', () => {
  it('un editor non può scriverla', async () => {
    const { session } = await createTestUser('editor');
    await expectUnauthorized(
      () =>
        createCallerWithSession(session).config.set({
          key: 'security.password.minLength',
          value: '8',
          encrypt: false,
        }),
      'FORBIDDEN'
    );
  });

  it('e nemmeno spegnere un requisito', async () => {
    const { session } = await createTestUser('editor');
    await expectUnauthorized(
      () =>
        createCallerWithSession(session).config.set({
          key: 'security.password.requireUppercase',
          value: 'false',
          encrypt: false,
        }),
      'FORBIDDEN'
    );
  });

  it('un admin sì', async () => {
    await expect(
      asAdmin().config.set({ key: 'security.password.minLength', value: '16', encrypt: false })
    ).resolves.toBeTruthy();
  });
});
