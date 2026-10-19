/**
 * The email-verification gate under a stored value the registry refuses (audit-4): it reads as
 * required, so it refuses an unverified LOCAL login and lets a verified one through; the break-glass
 * count and the local-access assessment apply the same reading. Before, any value other than the
 * literal `true` switched the gate off.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { appRouter } from '../src/routers/index';
import { countBreakGlassAdmins } from '../src/services/auth.service';
import { inspectLocalAccess } from '../src/services/localAccess.service';

import { TEST_USER_PASSWORD, createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let ip = 0;

beforeEach(async () => {
  prisma = await setupTestDb();
  await prisma.appConfig.create({ data: { key: 'auth.strategy', value: 'local-only', isEncrypted: false } });
});

/** A login from its own IP, so the per-IP `login` bucket never fills across the file. */
function login(username: string) {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.21.0.${++ip}` });
  return appRouter.createCaller(ctx).auth.login({ username, password: TEST_USER_PASSWORD });
}

async function unverified(role: 'admin' | 'editor') {
  const { user } = await createTestUser(role);
  return prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
}

describe.each([
  ['a value the registry refuses', { value: 'yes', isEncrypted: false }],
  ['an encrypted row', { value: 'v1:3q2+7w==:c2VjcmV0', isEncrypted: true }],
])('auth.requireEmailVerification stored as %s', (_label, row) => {
  beforeEach(async () => {
    await prisma.appConfig.create({ data: { key: 'auth.requireEmailVerification', ...row } });
  });

  it('refuses an unverified LOCAL login and admits a verified one', async () => {
    const pending = await unverified('editor');
    const { user: verified } = await createTestUser('editor');

    await expect(login(pending.username)).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'EMAIL_NOT_VERIFIED' });
    await expect(login(verified.username)).resolves.toMatchObject({ user: { id: verified.id } });
  });

  it('counts only verified administrators for break-glass', async () => {
    await unverified('admin');
    await createTestUser('admin');

    await expect(countBreakGlassAdmins(prisma)).resolves.toBe(1);
  });

  it('lists the unverified email among the blockers of local-access recovery', async () => {
    const admin = await unverified('admin');

    await expect(inspectLocalAccess(prisma, admin.username)).resolves.toMatchObject({
      blockers: ['email_unverified'],
    });
  });
});
