/**
 * Activating maintenance with force-logout revokes exactly the sessions that the maintenance
 * guard would block: the roles that cannot bypass it (`bypassesMaintenance`). The two used to
 * be separate role-name checks that could drift apart.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { forceLogoutNonAdmins } from '../src/lib/maintenanceMode';

import { createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('forceLogoutNonAdmins', () => {
  it('revokes editor and viewer sessions and leaves the admin signed in', async () => {
    const users = {
      admin: (await createTestUser('admin')).user,
      editor: (await createTestUser('editor')).user,
      viewer: (await createTestUser('viewer')).user,
    };

    await forceLogoutNonAdmins(prisma);

    const after = Object.fromEntries(
      await Promise.all(
        Object.entries(users).map(async ([role, user]) => [
          role,
          (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion - user.tokenVersion,
        ]),
      ),
    );
    expect(after).toEqual({ admin: 0, editor: 1, viewer: 1 });
  });
});
