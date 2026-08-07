/**
 * `users.update` — reset password admin (piano: docs/TASK_admin_password_reset_fix.md).
 *
 * `UpdateUserInputSchema` non aveva mai un campo `password`: il dialog "Modifica utente"
 * lo raccoglieva, ma il server lo scartava in silenzio. Questa suite copre il guard di
 * privilegio (`*:*`), il blocco self-reset, il locked-field per provider esterni, e gli
 * effetti collaterali attesi (tokenVersion, audit) sul percorso admin-to-admin.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
  createCallerWithIP,
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
  TEST_USER_PASSWORD,
} from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

type Role = 'admin' | 'editor' | 'viewer';

let prisma: PrismaClient;

const sessions = {} as Record<Role, UserSession>;

function usersAs(role: Role) {
  return createCallerWithSession(sessions[role]).users;
}

const NEW_PASSWORD = 'BrandNewPassw0rd!42';

beforeAll(async () => {
  prisma = await setupTestDb();

  const [admin, editor, viewer] = await Promise.all(
    (['admin', 'editor', 'viewer'] as Role[]).map(role => createTestUser(role))
  );
  sessions.admin = admin.session;
  sessions.editor = editor.session;
  sessions.viewer = viewer.session;
});

/** Utente LOCAL "usa e getta" per un singolo test — evita che i test si sporchino a vicenda. */
async function createTargetUser() {
  return createTestUser('viewer');
}

describe('users.update — reset password admin', () => {
  it('editor con users:update ma senza *:* → FORBIDDEN', async () => {
    const { user: target } = await createTargetUser();

    await expectUnauthorized(() =>
      usersAs('editor').update({ id: target.id, password: NEW_PASSWORD })
    );
  });

  it('admin resetta la password di un utente LOCAL → login vecchia fallisce, nuova funziona, tokenVersion incrementato, audit presente', async () => {
    const { user: target } = await createTargetUser();
    const tokenVersionBefore = target.tokenVersion;

    await usersAs('admin').update({ id: target.id, password: NEW_PASSWORD });

    const loginCaller = await createCallerWithIP('10.20.30.1', null);

    await expectUnauthorized(
      () => loginCaller.auth.login({ username: target.username, password: TEST_USER_PASSWORD }),
      'UNAUTHORIZED'
    );

    const loginResult = await loginCaller.auth.login({
      username: target.username,
      password: NEW_PASSWORD,
    });
    expect(loginResult).toBeTruthy();

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(refreshed.tokenVersion).toBe(tokenVersionBefore + 1);

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'USER_PASSWORD_RESET_BY_ADMIN', targetId: target.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow).toBeTruthy();
    expect(auditRow?.result).toBe('SUCCESS');
  });

  it('admin tenta di resettare la propria password via users.update → FORBIDDEN (deve passare da me.changePassword)', async () => {
    await expectUnauthorized(() =>
      usersAs('admin').update({ id: sessions.admin.user.id, password: NEW_PASSWORD })
    );
  });

  it('admin tenta di resettare la password di un utente LDAP → rigettato dal locked-field guard', async () => {
    const timestamp = Date.now();
    const ldapUser = await prisma.user.create({
      data: {
        email: `ldap-pwtest-${timestamp}@test.com`,
        username: `ldap-pwtest-${timestamp}`,
        firstName: 'LDAP',
        lastName: 'User',
        role: 'viewer',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.identity.create({
      data: {
        userId: ldapUser.id,
        provider: 'LDAP',
        providerId: `cn=ldap-pwtest-${timestamp}`,
      },
    });

    await expect(
      usersAs('admin').update({ id: ldapUser.id, password: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('password omessa: nessun bump di tokenVersion, nessuna riga USER_PASSWORD_RESET_BY_ADMIN', async () => {
    const { user: target } = await createTargetUser();
    const tokenVersionBefore = target.tokenVersion;

    await usersAs('admin').update({ id: target.id, firstName: 'Aggiornato' });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(refreshed.tokenVersion).toBe(tokenVersionBefore);
    expect(refreshed.firstName).toBe('Aggiornato');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'USER_PASSWORD_RESET_BY_ADMIN', targetId: target.id },
    });
    expect(auditRow).toBeNull();
  });

  it('password sotto i 12 caratteri → rigettata da Zod prima di raggiungere il router', async () => {
    const { user: target } = await createTargetUser();

    await expect(
      usersAs('admin').update({ id: target.id, password: 'short1!' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
