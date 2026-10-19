/**
 * An email change revokes the account's pending links, and no link escapes it (bugs-12).
 *
 * A reset or verification link mailed to the old address used to stay valid after the address
 * changed, so whoever held the old mailbox could still set the password. The change now deletes the
 * pending links in its own transaction, after the address `UPDATE`; issuance reads the address with
 * a lock on the user row, so a link created while a change is pending goes to the new address, or,
 * for a reset asked for the old one, is not created at all.
 *
 * The interleavings are held by hand: a paused side is released only once the other is seen waiting
 * on the row lock in `pg_stat_activity`, never after a sleep.
 */
import { createHash, randomBytes } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { issueUserToken, sendVerificationEmail } from '../src/lib/emailHelpers';
import * as mailer from '../src/lib/mailer';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';
import { confirmPasswordReset } from '../src/services/auth.service';
import { grantLocalAccess } from '../src/services/localAccess.service';

import {
  TEST_USER_PASSWORD,
  createCallerAs,
  createCallerWithSession,
  createTestContext,
  createTestUser,
  setupTestDb,
} from './helpers';

const NEW_PASSWORD = 'Recovered-Passw0rd!';

let prisma: PrismaClient;
let ip = 0;
let resetMails: MockInstance<typeof mailer.sendPasswordResetEmail>;
let verifyMails: MockInstance<typeof mailer.sendEmailVerificationEmail>;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  resetMails = vi.spyOn(mailer, 'sendPasswordResetEmail').mockResolvedValue(undefined);
  verifyMails = vi.spyOn(mailer, 'sendEmailVerificationEmail').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A pending RESET and VERIFY link for `userId`; returns their raw tokens. */
async function seedLinks(userId: string) {
  const raw = { RESET: randomBytes(32).toString('hex'), VERIFY: randomBytes(32).toString('hex') };
  for (const type of ['RESET', 'VERIFY'] as const) {
    await prisma.userToken.create({
      data: { userId, type, tokenHash: hash(raw[type]), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
  }
  return raw;
}

const links = (userId: string) => prisma.userToken.findMany({ where: { userId }, select: { type: true, tokenHash: true } });

/** Resolves once some backend of this database is waiting on a lock. */
async function untilSomeoneWaitsOnALock() {
  await vi.waitFor(
    async () => {
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      expect(n).toBeGreaterThan(0);
    },
    { timeout: 5_000, interval: 25 }
  );
}

/**
 * A change of address held open after its `UPDATE`, in the procedures' order (`UPDATE`, then the
 * links' delete). The real procedures own their transactions and cannot be paused.
 */
function heldChange(userId: string, newEmail: string) {
  const updated = deferred();
  const release = deferred();
  const done = prisma.$transaction(
    async tx => {
      await tx.user.update({ where: { id: userId }, data: { email: newEmail, emailVerifiedAt: null } });
      updated.resolve();
      await release.promise;
      await tx.userToken.deleteMany({ where: { userId } });
    },
    { timeout: 10_000 }
  );
  return { updated: updated.promise, release: release.resolve, done };
}

/** Each public call from its own IP, so the per-IP buckets never fill across the file. */
function publicAuth() {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.22.0.${++ip}` });
  return appRouter.createCaller(ctx).auth;
}

describe('an email change revokes the pending links', () => {
  it('on the admin update', async () => {
    const { user } = await createTestUser('editor');
    const raw = await seedLinks(user.id);
    const admin = await createCallerAs('admin');

    await admin.users.update({ id: user.id, email: 'moved@example.com' });

    await expect(links(user.id)).resolves.toEqual([]);
    await expect(
      confirmPasswordReset(createTestContext(null), { token: raw.RESET, newPassword: NEW_PASSWORD })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('on the self-service change', async () => {
    const { user, session } = await createTestUser('editor');
    await seedLinks(user.id);

    await createCallerWithSession(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD });

    // Only the verification link sent to the new address is left.
    const left = await links(user.id);
    expect(left).toHaveLength(1);
    expect(left[0].type).toBe('VERIFY');
    expect(verifyMails).toHaveBeenCalledWith(expect.anything(), 'moved@example.com', expect.any(String), expect.any(String));
  });
});

describe('a link issued while a change is pending', () => {
  it('does not issue a reset for the old address', async () => {
    const { user } = await createTestUser('editor');
    const change = heldChange(user.id, 'moved@example.com');
    await change.updated;

    const request = publicAuth().requestPasswordReset({ email: user.email });
    await untilSomeoneWaitsOnALock();
    change.release();
    await change.done;
    await expect(request).resolves.toMatchObject({ success: true });

    await expect(links(user.id)).resolves.toEqual([]);
    expect(resetMails).not.toHaveBeenCalled();
  });

  it('mails a verification link to the new address only', async () => {
    const { user } = await createTestUser('editor');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    const change = heldChange(user.id, 'moved@example.com');
    await change.updated;

    const send = sendVerificationEmail(prisma, { userId: user.id, reason: 'user_requested' });
    await untilSomeoneWaitsOnALock();
    change.release();
    await change.done;
    await send;

    const left = await links(user.id);
    expect(left.map(l => l.type)).toEqual(['VERIFY']);
    expect(verifyMails).toHaveBeenCalledTimes(1);
    expect(verifyMails).toHaveBeenCalledWith(expect.anything(), 'moved@example.com', expect.any(String), expect.any(String));
  });
});

describe('a change that runs while an issuance is still open', () => {
  it('revokes the link once the issuance commits', async () => {
    const { user, session } = await createTestUser('editor');
    const inserted = deferred();
    const release = deferred();
    const issuance = prisma.$transaction(
      async tx => {
        await issueUserToken(tx, user.id, 'RESET', { revokePrevious: false });
        inserted.resolve();
        await release.promise;
      },
      { timeout: 10_000 }
    );
    await inserted.promise;

    const change = createCallerWithSession(session).me.changeEmail({ newEmail: 'moved@example.com', currentPassword: TEST_USER_PASSWORD });
    await untilSomeoneWaitsOnALock();
    release.resolve();
    await issuance;
    await change;

    // The reset link is gone; only the verification link for the new address is left.
    const left = await links(user.id);
    expect(left.map(l => l.type)).toEqual(['VERIFY']);
  });

  it('lets local-access recovery wait for the change instead of deadlocking', async () => {
    // An administrator who already has a LOCAL identity with a credential under its username, so
    // recovery inserts no identity: its first write on the user's rows is the links.
    const { user } = await createTestUser('admin');
    const raw = await seedLinks(user.id);
    const change = heldChange(user.id, 'moved@example.com');
    await change.updated;

    const grant = grantLocalAccess(prisma, { id: user.id, username: user.username }, { anyway: true });
    await untilSomeoneWaitsOnALock();
    change.release();
    await change.done;
    const granted = await grant;

    const left = await links(user.id);
    expect(left).toEqual([{ type: 'RESET', tokenHash: hash(granted.token) }]);
    expect(left.some(l => l.tokenHash === hash(raw.RESET))).toBe(false);
  });
});

describe('a link consumed after a change deleted it', () => {
  it('answers that the link is not valid, and leaves the password as it was', async () => {
    const { user } = await createTestUser('editor');
    const raw = await seedLinks(user.id);
    const before = await prisma.localCredential.findFirstOrThrow({ where: { identity: { userId: user.id } } });

    // The change has run its UPDATE and its delete, and is still open: the confirm's lookup still
    // sees the link, then waits for the user row.
    const updated = deferred();
    const release = deferred();
    const change = prisma.$transaction(
      async tx => {
        await tx.user.update({ where: { id: user.id }, data: { email: 'moved@example.com', emailVerifiedAt: null } });
        await tx.userToken.deleteMany({ where: { userId: user.id } });
        updated.resolve();
        await release.promise;
      },
      { timeout: 10_000 }
    );
    await updated.promise;

    const confirm = confirmPasswordReset(createTestContext(null), { token: raw.RESET, newPassword: NEW_PASSWORD });
    await untilSomeoneWaitsOnALock();
    release.resolve();
    await change;

    await expect(confirm).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Token non valido o scaduto.' });
    const after = await prisma.localCredential.findFirstOrThrow({ where: { identity: { userId: user.id } } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});

describe('a reset request leaves earlier reset links valid', () => {
  it('keeps both links of two requests', async () => {
    const { user } = await createTestUser('editor');

    await publicAuth().requestPasswordReset({ email: user.email });
    await publicAuth().requestPasswordReset({ email: user.email });

    const left = await links(user.id);
    expect(left.filter(l => l.type === 'RESET')).toHaveLength(2);
  });
});
