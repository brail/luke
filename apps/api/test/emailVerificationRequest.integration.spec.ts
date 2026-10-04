/**
 * `auth.requestEmailVerification`: a signed-in user asks for a link to verify their own address.
 *
 * It used to be public and take an address, and it answered an unknown address, a verified one, a
 * sent mail and a failed send each differently — a way to learn which addresses have accounts. Its
 * one caller is the profile page of a signed-in user, for their own address, so it now takes no
 * address at all and works on the session's account: nothing to probe, and the real outcome,
 * a failed send included, is the answer.
 *
 * No SMTP server exists in this environment (`usersLocalAccess.integration.spec.ts`): the real send
 * always fails, which is the failure path asserted below; the success path spies the helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as emailHelpers from '../src/lib/emailHelpers';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function unverifiedUser() {
  const { user, session } = await createTestUser('viewer');
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  return { user, auth: appRouter.createCaller(createTestContext(session)).auth };
}

describe('auth.requestEmailVerification', () => {
  it("sends the link for the signed-in user's own account", async () => {
    const send = vi
      .spyOn(emailHelpers, 'sendVerificationEmail')
      .mockResolvedValue({ success: true, message: 'stubbed' });
    const { user, auth } = await unverifiedUser();

    await expect(auth.requestEmailVerification()).resolves.toEqual({ success: true, message: 'stubbed' });
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      { userId: user.id, reason: 'user_requested', actorId: user.id },
      expect.anything(),
    );
  });

  it('refuses a caller with no session: there is no address to ask about', async () => {
    const auth = appRouter.createCaller(createTestContext(null)).auth;

    await expect(auth.requestEmailVerification()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('says so when the mail could not be sent, and leaves the failure in the audit trail', async () => {
    const { user, auth } = await unverifiedUser();

    await expect(auth.requestEmailVerification()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'EMAIL_VERIFICATION_SENT', targetId: user.id } });
    // Inside a session the row names who acted, not an anonymous system.
    expect(audit).toMatchObject({ result: 'FAILURE', actorId: user.id });
  });

  it('refuses an LDAP account still on its synthetic address: a mail there reaches nobody', async () => {
    const { user, auth } = await unverifiedUser();
    await prisma.user.update({ where: { id: user.id }, data: { email: `${user.username}@ldap.local` } });

    await expect(auth.requestEmailVerification()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await prisma.userToken.count({ where: { userId: user.id, type: 'VERIFY' } })).toBe(0);
  });

  it('is limited per user, not per address: colleagues behind one IP each get their link', async () => {
    vi.spyOn(emailHelpers, 'sendVerificationEmail').mockResolvedValue({ success: true, message: 'stubbed' });
    // Every test context shares one IP; the old per-IP bucket allowed three requests from it.
    for (let colleague = 0; colleague < 4; colleague++) {
      const { auth } = await unverifiedUser();
      await expect(auth.requestEmailVerification()).resolves.toMatchObject({ success: true });
    }
  });

  it('sends nothing for an address already verified', async () => {
    const { session } = await createTestUser('viewer');
    const auth = appRouter.createCaller(createTestContext(session)).auth;

    await expect(auth.requestEmailVerification()).resolves.toMatchObject({ success: true, message: 'Email già verificata.' });
    expect(await prisma.userToken.count({ where: { userId: session.user.id, type: 'VERIFY' } })).toBe(0);
  });
});

describe('auth.requestEmailVerificationAdmin', () => {
  it('lets an editor, who manages users, send the link to an account', async () => {
    const send = vi
      .spyOn(emailHelpers, 'sendVerificationEmail')
      .mockResolvedValue({ success: true, message: 'stubbed' });
    const { session } = await createTestUser('editor');
    const { user: target } = await createTestUser('viewer');
    const auth = appRouter.createCaller(createTestContext(session)).auth;

    await expect(auth.requestEmailVerificationAdmin({ userId: target.id })).resolves.toMatchObject({ success: true });
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      { userId: target.id, reason: 'admin_initiated', actorId: session.user.id },
      expect.anything(),
    );
  });

  it('refuses an account still on its synthetic LDAP address', async () => {
    const { session } = await createTestUser('admin');
    const { user: target } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: target.id }, data: { email: `${target.username}@ldap.local` } });
    const auth = appRouter.createCaller(createTestContext(session)).auth;

    await expect(auth.requestEmailVerificationAdmin({ userId: target.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await prisma.userToken.count({ where: { userId: target.id, type: 'VERIFY' } })).toBe(0);
  });
});

describe('sendVerificationEmail, whoever calls it', () => {
  it('refuses a synthetic LDAP address before creating a token', async () => {
    const { user } = await createTestUser('viewer');
    await prisma.user.update({
      where: { id: user.id },
      data: { email: `${user.username}@ldap.local`, emailVerifiedAt: null },
    });

    await expect(emailHelpers.sendVerificationEmail(prisma, { userId: user.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await prisma.userToken.count({ where: { userId: user.id, type: 'VERIFY' } })).toBe(0);
  });
});
