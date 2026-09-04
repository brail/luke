/**
 * `users.update` — admin password reset (plan: docs/TASK_admin_password_reset_fix.md).
 *
 * `UpdateUserInputSchema` never had a `password` field: the "Edit user" dialog
 * collected it, but the server silently discarded it. This suite covers the privilege guard (`*:*`),
 * self-reset block, locked-field for external providers, and expected side effects
 * (tokenVersion, audit) on the admin-to-admin path.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { USER_EDITOR_UPDATABLE_FIELDS, UpdateUserInputSchema, privilegedUserUpdateFields } from '@luke/core';
import type { PrivilegedUserUpdateField, UserEditorUpdatableField } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import {
  createCallerWithIP,
  createCallerWithSession,
  createTestUser,
  expectUnauthorized,
  setupTestDb,
  TEST_USER_PASSWORD,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

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

/** LOCAL "throwaway" user for a single test — prevents tests from dirtying each other. */
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

  it('utente dual-identity (LDAP + LOCAL, es. dopo forceLocalAccess) → password reset resta bloccato', async () => {
    // Regression test for the `identities[0]` nondeterminism fixed alongside
    // `forceLocalAccess`/`revokeLocalAccess`: a user can now hold more than one identity, and
    // `getLockedFields` must key off the external one deterministically, not an unordered `[0]`.
    const timestamp = Date.now();
    const dualUser = await prisma.user.create({
      data: {
        email: `dual-pwtest-${timestamp}@test.com`,
        username: `dual-pwtest-${timestamp}`,
        firstName: 'Dual',
        lastName: 'User',
        role: 'viewer',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    // LOCAL identity created first, LDAP second: the ordering that would have broken a naive
    // `identities[0]` read (which would have resolved to LOCAL → password wrongly unlocked).
    const localIdentity = await prisma.identity.create({
      data: { userId: dualUser.id, provider: 'LOCAL', providerId: dualUser.username },
    });
    await prisma.localCredential.create({
      data: { identityId: localIdentity.id, passwordHash: 'not-a-real-hash' },
    });
    await prisma.identity.create({
      data: { userId: dualUser.id, provider: 'LDAP', providerId: `cn=dual-pwtest-${timestamp}` },
    });

    await expect(
      usersAs('admin').update({ id: dualUser.id, password: NEW_PASSWORD })
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

  it('password sotto il prefiltro statico → rigettata da Zod, non dalla policy', async () => {
    // The title used to claim the rejection happened before the router, while asserting only
    // `BAD_REQUEST` — which `assertPasswordMeetsPolicy` produces too, from inside it. Lowering the
    // prefilter left it green. Asserting the message distinguishes the two: Zod's wording is the
    // prefilter's own, and the policy answers `Password non valida: …`.
    //
    // The prefilter is 8, not 12: the real minimum comes from the configured policy and is proved
    // in `passwordPolicyEnforcement.integration.spec.ts`.
    const { user: target } = await createTargetUser();

    await expect(
      usersAs('admin').update({ id: target.id, password: 'Ab1!efg' })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('Password deve essere di almeno 8 caratteri'),
    });
  });
});

/**
 * SEC-A — a caller holding `users:update` without `*:*` may change only the
 * fields explicitly classified as editor-permitted on someone else's account.
 *
 * The concrete defect was an editor repointing an admin's email and then
 * driving the public password-reset flow to obtain the account. The reset was
 * never the defect: it behaves correctly for whoever owns the address on
 * record, which is exactly what made the chain work.
 *
 * The matrices below iterate `privilegedUserUpdateFields()` and
 * `USER_EDITOR_UPDATABLE_FIELDS`, the same two declarations the router
 * consumes, so the authorization surface cannot be tested against a stale copy
 * of itself. The sample maps are typed `Record<…Field, …>`: a field added to
 * `UpdateUserInputSchema` and left unclassified lands in the privileged
 * complement automatically and fails `typecheck:test` here for a missing key,
 * so it cannot reach production silently permitted.
 */

/** One attacker-supplied value per privileged field. Keys are exhaustive by type. */
const PRIVILEGED_SAMPLE: Record<PrivilegedUserUpdateField, unknown> = {
  email: `takeover-${Date.now()}@evil.test`,
  username: `takeover${Date.now()}`,
  // Must differ from the target's stored value or the guard correctly treats it
  // as a no-op: the target below is an admin, so demoting is the real attempt.
  role: 'viewer',
};

/** One legitimate value per editor-permitted field. Keys are exhaustive by type. */
const EDITOR_SAMPLE: Record<UserEditorUpdatableField, unknown> = {
  firstName: 'Modificato',
  lastName: 'DaEditor',
  isActive: false,
};

describe('users.update — cross-user field authorization (SEC-A)', () => {
  it.each(privilegedUserUpdateFields())(
    'editor con users:update ma senza *:* non può cambiare %s di un admin',
    async field => {
      const { user: adminTarget } = await createTestUser('admin');
      const before = await prisma.user.findUniqueOrThrow({ where: { id: adminTarget.id } });

      await expectUnauthorized(() =>
        usersAs('editor').update({ id: adminTarget.id, [field]: PRIVILEGED_SAMPLE[field] })
      );

      // The rejection must also mean the write did not happen. An endpoint that
      // throws after persisting would satisfy the assertion above and still be
      // exploitable.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: adminTarget.id } });
      expect(after.email).toBe(before.email);
      expect(after.username).toBe(before.username);
      expect(after.role).toBe(before.role);
    }
  );

  it.each(USER_EDITOR_UPDATABLE_FIELDS)(
    'editor conserva la capacità legittima di cambiare %s',
    async field => {
      // The other half of the boundary. A guard that froze the whole procedure
      // for editors would pass every test above and get reverted in a week.
      const { user: target } = await createTargetUser();

      await usersAs('editor').update({ id: target.id, [field]: EDITOR_SAMPLE[field] });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(after[field]).toBe(EDITOR_SAMPLE[field]);
    }
  );

  it('la classificazione copre esattamente lo schema: nessun campo resta non classificato', () => {
    // Belt to the type-level braces: proves at runtime that the two sets
    // partition the schema, so a field cannot be silently absent from both.
    const schemaFields = Object.keys(UpdateUserInputSchema.shape)
      .filter(f => f !== 'id' && f !== 'password')
      .sort();
    const classified = [...privilegedUserUpdateFields(), ...USER_EDITOR_UPDATABLE_FIELDS].sort();

    expect(classified).toEqual(schemaFields);
  });

  it('la catena di takeover si interrompe al primo passo: il reset password non raggiunge un indirizzo iniettato', async () => {
    const { user: adminTarget } = await createTestUser('admin');
    const attackerEmail = `chain-${Date.now()}@evil.test`;

    await expectUnauthorized(() =>
      usersAs('editor').update({ id: adminTarget.id, email: attackerEmail })
    );

    // No user carries the attacker's address, so the public reset flow has
    // nothing to send there. `requestPasswordReset` answers generically either
    // way (enumeration protection), so assert on state rather than on its reply.
    const holder = await prisma.user.findFirst({ where: { email: attackerEmail } });
    expect(holder).toBeNull();

    const caller = await createCallerWithIP('10.20.30.9', null);
    await caller.auth.requestPasswordReset({ email: attackerEmail });

    const tokens = await prisma.userToken.findMany({
      where: { type: 'RESET', userId: adminTarget.id },
    });
    expect(tokens).toHaveLength(0);
  });

  it('admin cambia legittimamente la email: riesce, azzera emailVerifiedAt e invalida le sessioni', async () => {
    const { user: target } = await createTargetUser();
    await prisma.user.update({
      where: { id: target.id },
      data: { emailVerifiedAt: new Date() },
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(before.emailVerifiedAt).not.toBeNull();

    const newEmail = `moved-${Date.now()}@example.test`;
    await usersAs('admin').update({ id: target.id, email: newEmail });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.email).toBe(newEmail);
    // The address on record is what the recovery flow trusts; it must not
    // inherit the verified state of the address it replaced.
    expect(after.emailVerifiedAt).toBeNull();
    // An identity change invalidates issued tokens, like a role or password change.
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  });

  it('admin che riscrive la stessa email non è bloccato e non invalida le sessioni', async () => {
    // The guard must compare against the stored value, not merely detect the
    // key's presence: an idempotent update carrying the unchanged email is a
    // normal edit-dialog save.
    const { user: target } = await createTargetUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });

    await usersAs('admin').update({ id: target.id, email: before.email, firstName: 'Rinominato' });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.firstName).toBe('Rinominato');
    expect(after.tokenVersion).toBe(before.tokenVersion);
  });
});
