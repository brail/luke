/**
 * A signed-in user's email changes through `me.changeEmail` only.
 *
 * `me.updateProfile` also wrote it: lower-case-blind, without a verification mail, and an address
 * another account held hit the unique constraint as a 500. Its form only ever sent the current
 * address back, so the write is gone: the profile schema has no email, and an `email` sent anyway
 * is dropped by the input parser. `me.changeEmail` answers a taken address with CONFLICT from the
 * write itself — the unique constraint is the check, with no read before it to race.
 *
 * Residual: a legacy row stored with capitals is not matched by the lower-cased new address, so
 * the constraint does not see the two as the same.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as emailHelpers from '../src/lib/emailHelpers';
import { rateLimitStore } from '../src/lib/ratelimit';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  vi.spyOn(emailHelpers, 'sendVerificationEmail').mockResolvedValue({ success: true, message: 'stubbed' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PROFILE = { firstName: 'Mario', lastName: 'Rossi', locale: 'it-IT', timezone: 'Europe/Rome' };

describe('me.updateProfile', () => {
  it('leaves the email and its verification alone, whatever the input carries', async () => {
    const { user, session } = await createTestUser('viewer');
    const { user: other } = await createTestUser('viewer');
    const caller = createCallerWithSession(session);

    // Typed without `email` now; sent anyway, as an old client would.
    await caller.me.updateProfile({ ...PROFILE, email: other.email } as typeof PROFILE);

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved).toMatchObject({ email: user.email, firstName: 'Mario', emailVerifiedAt: user.emailVerifiedAt });
  });
});

describe('me.changeEmail', () => {
  it('changes the address, lower-cased, and asks to verify it', async () => {
    const { user, session } = await createTestUser('viewer');

    await createCallerWithSession(session).me.changeEmail({ newEmail: 'Nuovo@Example.COM' });

    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      email: 'nuovo@example.com',
      emailVerifiedAt: null,
    });
    expect(emailHelpers.sendVerificationEmail).toHaveBeenCalledWith(
      expect.anything(),
      { userId: user.id, reason: 'email_changed', actorId: user.id },
      expect.anything(),
    );
    expect(await prisma.auditLog.findFirst({ where: { action: 'EMAIL_CHANGED', targetId: user.id } })).toMatchObject({
      actorId: user.id,
      result: 'SUCCESS',
    });
  });

  it('answers an address another account holds with CONFLICT, from the write itself', async () => {
    const { user, session } = await createTestUser('viewer');
    const { user: other } = await createTestUser('viewer');

    await expect(createCallerWithSession(session).me.changeEmail({ newEmail: other.email })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
    });
  });
});
