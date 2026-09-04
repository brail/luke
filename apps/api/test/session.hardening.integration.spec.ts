/**
 * Integration tests for Session Hardening
 * Verifies tokenVersion, session invalidation, TTL
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { PrismaClient } from '@luke/db';

import { authenticateRequest, createToken } from '../src/lib/auth';
import { signJWT } from '../src/lib/jwt';
import { invalidateTokenVersionCache } from '../src/lib/trpc';

import {
  createCallerWithSession,
  createTestUser,
  setupTestDb,
  TEST_USER_PASSWORD,
} from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  // The schema is guaranteed by `setupTestDb()` applying the Prisma migrations.
  // There used to be five hand-written `CREATE TABLE IF NOT EXISTS` here, leftovers
  // from the SQLite era (`DATETIME`, `INTEGER` booleans) on a Postgres database:
  // inert because the tables already existed, and with columns that no longer
  // matched the model (`audit_logs` declared `userId`,
  // `resource`, `ipAddress`, `timestamp`).
  prisma = await setupTestDb();

  // Seed config for cache TTL
  await prisma.appConfig.create({
    data: {
      key: 'security.tokenVersionCacheTTL',
      value: '60000',
      isEncrypted: false,
    },
  });
});

describe('Session Hardening — tokenVersion', () => {
  it('Login → Call OK → ChangePassword → Call UNAUTHORIZED', async () => {
    // 1. LOCAL user with tokenVersion=0, identity and credential: `me.changePassword`
    // without a local credential responds FORBIDDEN instead of UNAUTHORIZED, i.e.
    // it exercises the wrong branch. That's exactly what `createTestUser` guarantees.
    const { user, session } = await createTestUser('viewer');

    // 2. Protected call → OK. The session starts at tokenVersion=0, which is what
    // `protectedProcedure` compares against the user row.
    const caller1 = createCallerWithSession(session);
    const profile1 = await caller1.me.get();
    expect(profile1.id).toBe(user.id);

    // 3. ChangePassword → tokenVersion++
    await caller1.me.changePassword({
      currentPassword: TEST_USER_PASSWORD,
      newPassword: 'NewPass456!Longer',
      confirmNewPassword: 'NewPass456!Longer',
    });

    // Manually invalidate cache (simulates propagation)
    invalidateTokenVersionCache(user.id);

    // 4. Verify DB: tokenVersion=1
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(updatedUser?.tokenVersion).toBe(1);

    // 5. Protected call with OLD token (session still at tokenVersion=0)
    await expect(createCallerWithSession(session).me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('RevokeAllSessions → Vecchio token rifiutato', async () => {
    const { user, session } = await createTestUser('viewer');

    // Revoke all sessions
    await createCallerWithSession(session).me.revokeAllSessions();

    invalidateTokenVersionCache(user.id);

    // Verify tokenVersion incremented
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(updatedUser?.tokenVersion).toBe(1);

    // Old token rejected
    await expect(createCallerWithSession(session).me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('JWT senza tokenVersion → UNAUTHORIZED', async () => {
    const { session } = await createTestUser('viewer');

    // Session WITHOUT tokenVersion (simulates an old JWT)
    const staleSession = {
      user: { ...session.user, tokenVersion: undefined },
    };

    // Must reject
    await expect(
      createCallerWithSession(staleSession).me.get()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('Token scaduto (exp manomesso) → UNAUTHORIZED', async () => {
    const { user } = await createTestUser('viewer');

    // Generate token with a past exp (-1h)
    const expiredToken = signJWT(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: 0,
      },
      { expiresIn: '-1h' }
    ); // Already-expired token

    // Verify that verifyJWT rejects it (indirect test)
    const { verifyJWT } = await import('../src/lib/jwt');
    const payload = verifyJWT(expiredToken);
    expect(payload).toBeNull(); // Expired token not validated
  });

  it('Utente isActive=false → UNAUTHORIZED', async () => {
    const { user, session } = await createTestUser('viewer');

    // The session stays valid: it's the user row that becomes inactive, and it's
    // the one `protectedProcedure` must re-read.
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    // Must reject disabled user
    await expect(
      createCallerWithSession(session).me.get()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('Session Hardening — revoca su tutta la superficie', () => {
  it('authenticateRequest rifiuta un token revocato (route non-tRPC)', async () => {
    const { user } = await createTestUser('viewer');
    const token = createToken({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 0,
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const reply = { clearCookie: () => {} } as any;

    // Before revocation the token is good.
    await expect(authenticateRequest(req, reply, prisma)).resolves.not.toBeNull();

    // Explicit revocation: this is what `users.revokeUserSessions` does in production.
    await prisma.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });
    invalidateTokenVersionCache(user.id);

    // The check lives inside `authenticateRequest`, not one level up: it used to
    // live only in the tRPC middleware, and every Fastify route (logo upload, calendar
    // export, backup restore) accepted revoked tokens for the entire JWT
    // lifetime — up to 7 days.
    await expect(authenticateRequest(req, reply, prisma)).resolves.toBeNull();
  });

  it('authenticateRequest rifiuta un utente disattivato', async () => {
    const { user } = await createTestUser('viewer');
    const token = createToken({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 0,
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const reply = { clearCookie: () => {} } as any;

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    invalidateTokenVersionCache(user.id);

    await expect(authenticateRequest(req, reply, prisma)).resolves.toBeNull();
  });
});

describe('Session Hardening — retrocessione di ruolo', () => {
  it('declassare un admin invalida i suoi token e refreshToken non ricicla il ruolo', async () => {
    // A second admin is needed: the procedure refuses to remove the role
    // from the last remaining administrator.
    const [actingAdmin, victim] = await Promise.all([
      createTestUser('admin'),
      createTestUser('admin'),
    ]);

    const victimCaller = createCallerWithSession(victim.session);
    // Before the demotion the session is valid.
    await expect(victimCaller.me.get()).resolves.toBeDefined();

    await createCallerWithSession(actingAdmin.session).users.update({
      id: victim.user.id,
      role: 'viewer',
    });

    // The old token still carries `role: "admin"`, and `requirePermission` reads
    // the role from the claim. The only thing that stops it is the `tokenVersion` bump.
    await expect(
      createCallerWithSession(victim.session).me.get()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // And refresh must not be able to reissue an admin token: it used to re-sign from
    // the old claim, so the demoted user could renew their authority indefinitely.
    await expect(
      createCallerWithSession(victim.session).auth.refreshToken()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const stored = await prisma.user.findUnique({
      where: { id: victim.user.id },
      select: { role: true, tokenVersion: true },
    });
    expect(stored?.role).toBe('viewer');
    expect(stored?.tokenVersion).toBe(1);
  });
});
