/**
 * `users.forceLocalAccess` / `users.revokeLocalAccess` — admin-only bypass for an LDAP/OIDC
 * account whose external identity provider (AD) disables or deletes it, locking the user out
 * with no fallback. `forceLocalAccess` grants a LOCAL identity alongside the existing external
 * one (never removing it); `revokeLocalAccess` reverses that, refusing to remove a user's only
 * remaining identity.
 *
 * Covers the guards specific to these two procedures (admin-only despite `users:update` being
 * granted to editor, self-lockout on revoke, the "only identity" refusal) and the two
 * correctness fixes applied during code review:
 *  - `forceLocalAccess` cleans up the orphaned RESET token if the email send fails, instead of
 *    leaving an unusable LOCAL identity with no way to reach it
 *  - `revokeLocalAccess` re-reads and re-validates inside its own transaction, so a second call
 *    on an already-revoked user gets a clean BAD_REQUEST instead of a raw Prisma error
 *
 * No SMTP test infrastructure exists in this project (no mail catcher in `docker-compose.test.yml`,
 * no `smtp.*` AppConfig seeding) — every other email-sending procedure in this suite has the same
 * gap, and `vi.mock('../src/lib/mailer', ...)` does not reliably intercept calls reached through
 * the shared `appRouter` singleton here (verified: the mock factory runs, but the resolver still
 * hits the real `sendEmail`/`getSmtpConfig` and fails with "Configurazione SMTP incompleta").
 * `sendPasswordResetEmail` therefore *always* fails in this environment — the tests below assert
 * the real, always-reachable failure path (identity created, token cleaned up, mutation surfaces
 * INTERNAL_SERVER_ERROR) instead of a mocked happy path that can't actually be exercised here.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeAll } from 'vitest';

import type { PrismaClient } from '@luke/db';

import {
  createCallerWithSession,
  createTestUser,
  expectToThrow,
  expectUnauthorized,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

type Role = 'admin' | 'editor' | 'viewer';

let prisma: PrismaClient;
const sessions = {} as Record<Role, UserSession>;

function usersAs(role: Role) {
  return createCallerWithSession(sessions[role]).users;
}

beforeAll(async () => {
  prisma = await setupTestDb();

  const [admin, editor, viewer] = await Promise.all(
    (['admin', 'editor', 'viewer'] as Role[]).map(role => createTestUser(role))
  );
  sessions.admin = admin.session;
  sessions.editor = editor.session;
  sessions.viewer = viewer.session;
});

/** LDAP-only user with a real (non-synthetic) email — the documented target of `forceLocalAccess`. */
async function createLdapUser(emailSuffix = '@test.com') {
  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `ldap-fla-${uid}${emailSuffix}`,
      username: `ldap-fla-${uid}`,
      firstName: 'LDAP',
      lastName: 'User',
      role: 'viewer',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.identity.create({
    data: { userId: user.id, provider: 'LDAP', providerId: `cn=ldap-fla-${uid}` },
  });
  return user;
}

/** Simulates the post-`forceLocalAccess` state directly, without depending on that procedure. */
async function createDualIdentityUser() {
  const user = await createLdapUser();
  const identity = await prisma.identity.create({
    data: { userId: user.id, provider: 'LOCAL', providerId: user.username },
  });
  await prisma.localCredential.create({
    data: { identityId: identity.id, passwordHash: 'not-a-real-hash' },
  });
  return user;
}

describe('users.forceLocalAccess', () => {
  it('editor con users:update ma senza *:* → FORBIDDEN', async () => {
    const target = await createLdapUser();
    await expectUnauthorized(() => usersAs('editor').forceLocalAccess({ id: target.id }));
  });

  it('viewer → FORBIDDEN', async () => {
    const target = await createLdapUser();
    await expectUnauthorized(() => usersAs('viewer').forceLocalAccess({ id: target.id }));
  });

  it('anonimo → UNAUTHORIZED', async () => {
    const target = await createLdapUser();
    const anon = createCallerWithSession(null as unknown as UserSession);
    await expectUnauthorized(() => anon.users.forceLocalAccess({ id: target.id }), 'UNAUTHORIZED');
  });

  it('utente senza identity esterna (solo LOCAL) → BAD_REQUEST, nessuna identity aggiuntiva creata', async () => {
    const { user: target } = await createTestUser('viewer');

    await expectToThrow(usersAs('admin').forceLocalAccess({ id: target.id }), {
      code: 'BAD_REQUEST',
    });

    const identities = await prisma.identity.findMany({ where: { userId: target.id } });
    expect(identities).toHaveLength(1);
  });

  it('utente LDAP con email sintetica @ldap.local → BAD_REQUEST, nessuna identity LOCAL creata', async () => {
    const target = await createLdapUser('@ldap.local');

    await expectToThrow(usersAs('admin').forceLocalAccess({ id: target.id }), {
      code: 'BAD_REQUEST',
    });

    const localIdentity = await prisma.identity.findFirst({
      where: { userId: target.id, provider: 'LOCAL' },
    });
    expect(localIdentity).toBeNull();
  });

  it('utente LDAP con email reale → crea identity LOCAL + credential, lascia intatta quella LDAP, anche se il successivo invio email fallisce (nessuna SMTP di test)', async () => {
    const target = await createLdapUser();

    // Sending always fails in this environment (see file header) — the identity/credential
    // creation happens in its own transaction beforehand and must survive that failure.
    await expectToThrow(usersAs('admin').forceLocalAccess({ id: target.id }), {
      code: 'INTERNAL_SERVER_ERROR',
    });

    const identities = await prisma.identity.findMany({ where: { userId: target.id } });
    expect(identities.map(i => i.provider).sort()).toEqual(['LDAP', 'LOCAL']);

    const localIdentity = identities.find(i => i.provider === 'LOCAL')!;
    const credential = await prisma.localCredential.findUnique({
      where: { identityId: localIdentity.id },
    });
    expect(credential).not.toBeNull();

    // Not asserting the audit row here: `withAuditLog` has a pre-existing, unrelated bug that
    // logs 'SUCCESS' even when the mutation throws (see `auditMiddleware.integration.spec.ts`,
    // discovered while writing this suite) — asserting 'FAILURE' here would just be documenting
    // that bug a second time under this procedure's name, not this procedure's own behavior.
  });

  it('utente già dual-identity (resend) → non duplica la identity LOCAL', async () => {
    const target = await createDualIdentityUser();

    await expectToThrow(usersAs('admin').forceLocalAccess({ id: target.id }), {
      code: 'INTERNAL_SERVER_ERROR',
    });

    const identities = await prisma.identity.findMany({ where: { userId: target.id } });
    expect(identities.filter(i => i.provider === 'LOCAL')).toHaveLength(1);
  });

  it('invio email fallito → INTERNAL_SERVER_ERROR, token RESET orfano cancellato, identity LOCAL resta (operazione idempotente)', async () => {
    const target = await createLdapUser();

    await expectToThrow(usersAs('admin').forceLocalAccess({ id: target.id }), {
      code: 'INTERNAL_SERVER_ERROR',
    });

    const localIdentity = await prisma.identity.findFirst({
      where: { userId: target.id, provider: 'LOCAL' },
    });
    expect(localIdentity).not.toBeNull();

    const orphanedToken = await prisma.userToken.findFirst({
      where: { userId: target.id, type: 'RESET' },
    });
    expect(orphanedToken).toBeNull();
  });
});

describe('users.revokeLocalAccess', () => {
  it('editor con users:update ma senza *:* → FORBIDDEN', async () => {
    const target = await createDualIdentityUser();
    await expectUnauthorized(() => usersAs('editor').revokeLocalAccess({ id: target.id }));
  });

  it("admin tenta di revocare il proprio accesso locale → FORBIDDEN (guardia self-lockout)", async () => {
    await expectUnauthorized(() =>
      usersAs('admin').revokeLocalAccess({ id: sessions.admin.user.id })
    );
  });

  it('utente senza identity LOCAL → BAD_REQUEST', async () => {
    const target = await createLdapUser();
    await expectToThrow(usersAs('admin').revokeLocalAccess({ id: target.id }), {
      code: 'BAD_REQUEST',
    });
  });

  it("utente solo LOCAL (nessuna identity esterna di fallback) → BAD_REQUEST, identity non toccata", async () => {
    const { user: target } = await createTestUser('viewer');

    await expectToThrow(usersAs('admin').revokeLocalAccess({ id: target.id }), {
      code: 'BAD_REQUEST',
    });

    const identities = await prisma.identity.findMany({ where: { userId: target.id } });
    expect(identities).toHaveLength(1);
  });

  it('utente dual-identity → rimuove solo la identity LOCAL, bump tokenVersion, audit SUCCESS', async () => {
    const target = await createDualIdentityUser();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });

    const result = await usersAs('admin').revokeLocalAccess({ id: target.id });
    expect(result.success).toBe(true);

    const identities = await prisma.identity.findMany({ where: { userId: target.id } });
    expect(identities.map(i => i.provider)).toEqual(['LDAP']);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'USER_LOCAL_ACCESS_REVOKED', targetId: target.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow?.result).toBe('SUCCESS');
  });

  it('seconda chiamata sullo stesso utente (già revocato) → BAD_REQUEST pulito, non un errore Prisma grezzo', async () => {
    const target = await createDualIdentityUser();

    await usersAs('admin').revokeLocalAccess({ id: target.id });

    await expectToThrow(usersAs('admin').revokeLocalAccess({ id: target.id }), {
      code: 'BAD_REQUEST',
    });
  });
});
