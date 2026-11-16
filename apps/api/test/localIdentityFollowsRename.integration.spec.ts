/**
 * #229: local sign-in finds the LOCAL identity by the current username, so a rename moves it, in the
 * rename's transaction and under its lock; migration `20261116160000_local_identity_follows_username`
 * moves the identities an earlier rename left behind, where ownership is unambiguous.
 *
 * The migration tests seed rows inside one transaction, run the migration file there, read the result
 * and roll back: the test database already holds the migration.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PRISMA_MIGRATIONS_DIR, type PrismaClient } from '@luke/db';

import { authenticateLocal, countBreakGlassAdmins } from '../src/services/auth.service';

import { TEST_USER_PASSWORD, createCallerAs, createTestUser, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';

const MIGRATION = readFileSync(
  join(PRISMA_MIGRATIONS_DIR, '20261116160000_local_identity_follows_username', 'migration.sql'),
  'utf8'
);

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

const localIdentityOf = (userId: string) =>
  prisma.identity.findMany({ where: { userId, provider: 'LOCAL' }, select: { id: true, providerId: true } });

describe('a rename moves the LOCAL identity', () => {
  it('signs in under the new username, not the old one', async () => {
    const { user } = await createTestUser('editor');
    const admin = await createCallerAs('admin');

    await admin.users.update({ id: user.id, username: 'renamed-editor' });

    expect(await authenticateLocal(prisma, 'renamed-editor', TEST_USER_PASSWORD)).toMatchObject({ id: user.id });
    expect(await authenticateLocal(prisma, user.username, TEST_USER_PASSWORD)).toBeNull();
  });

  it('keeps a renamed admin counted for break-glass sign-in', async () => {
    const { user } = await createTestUser('admin');
    const admin = await createCallerAs('admin');
    const before = await countBreakGlassAdmins(prisma);

    await admin.users.update({ id: user.id, username: 'renamed-admin' });

    expect(await countBreakGlassAdmins(prisma)).toBe(before);
  });

  it('answers CONFLICT when a LOCAL identity already holds the new name, changing nothing', async () => {
    const { user } = await createTestUser('editor');
    const { user: other } = await createTestUser('viewer');
    // Another account's identity left under a free username by an earlier rename.
    await prisma.identity.updateMany({ where: { userId: other.id, provider: 'LOCAL' }, data: { providerId: 'taken-name' } });
    const admin = await createCallerAs('admin');

    await expect(admin.users.update({ id: user.id, username: 'taken-name' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).username).toBe(user.username);
    expect(await localIdentityOf(user.id)).toMatchObject([{ providerId: user.username }]);
  });

  it('reads the username under the lock: a rename that waited moves the identity from where the first left it', async () => {
    const { user } = await createTestUser('editor');
    const admin = await createCallerAs('admin');

    // The holder is a rename that committed first: it holds the user row, then renames user and
    // identity to `first-name`. The real rename waits on the row, then must move from `first-name`.
    const outcome = await whileHeld(
      holder => holder.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]),
      () => admin.users.update({ id: user.id, username: 'second-name' }),
      async holder => {
        await holder.query("UPDATE users SET username = 'first-name' WHERE id = $1", [user.id]);
        await holder.query("UPDATE identities SET \"providerId\" = 'first-name' WHERE \"userId\" = $1 AND provider = 'LOCAL'", [user.id]);
      }
    );

    expect(outcome.status).toBe('fulfilled');
    expect(await localIdentityOf(user.id)).toMatchObject([{ providerId: 'second-name' }]);
    expect(await authenticateLocal(prisma, 'second-name', TEST_USER_PASSWORD)).toMatchObject({ id: user.id });
  });
});

describe('forceLocalAccess files the LOCAL identity under the current username', () => {
  it('waits on a rename holding the user row, then files it under the new name', async () => {
    const user = await prisma.user.create({
      data: {
        timezone: 'Europe/Rome',
        email: 'ldap-race@example.com',
        username: 'ldap-race',
        role: 'viewer',
        isActive: true,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.identity.create({ data: { userId: user.id, provider: 'LDAP', providerId: 'cn=ldap-race' } });
    const admin = await createCallerAs('admin');

    // The holder is a rename of this LDAP-only user (nothing local to move) holding the row.
    await whileHeld(
      holder => holder.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]),
      () => admin.users.forceLocalAccess({ id: user.id }),
      holder => holder.query("UPDATE users SET username = 'ldap-race-renamed' WHERE id = $1", [user.id])
    );

    // Whatever the link mail did, the identity is under the name the user signs in with.
    expect(await localIdentityOf(user.id)).toMatchObject([{ providerId: 'ldap-race-renamed' }]);
  });
});

describe('migration 20261116160000_local_identity_follows_username', () => {
  let client: Client;

  beforeEach(async () => {
    client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  const fileUnder = (identityUserId: string, name: string) =>
    client.query(`UPDATE identities SET "providerId" = $2 WHERE "userId" = $1 AND provider = 'LOCAL'`, [identityUserId, name]);
  const localOf = async (userId: string) =>
    (
      await client.query<{ id: string; providerId: string }>(
        `SELECT id, "providerId" FROM identities WHERE "userId" = $1 AND provider = 'LOCAL' ORDER BY "providerId"`,
        [userId]
      )
    ).rows;

  it('moves a stale identity under its user, keeping its id and credential, and runs twice', async () => {
    const { user } = await createTestUser('editor');
    await fileUnder(user.id, 'old-name');
    const [before] = await localOf(user.id);

    await client.query(MIGRATION);
    await client.query(MIGRATION);

    expect(await localOf(user.id)).toEqual([{ id: before!.id, providerId: user.username }]);
    const credentials = await client.query('SELECT 1 FROM local_credentials WHERE "identityId" = $1', [before!.id]);
    expect(credentials.rowCount).toBe(1);
  });

  it('follows a chain: an identity waiting on a name another one leaves moves after it', async () => {
    const { user } = await createTestUser('editor');
    const { user: other } = await createTestUser('viewer');
    await fileUnder(user.id, 'old-name');
    await fileUnder(other.id, user.username);

    await client.query(MIGRATION);

    expect(await localOf(other.id)).toMatchObject([{ providerId: other.username }]);
    expect(await localOf(user.id)).toMatchObject([{ providerId: user.username }]);
  });

  it('leaves a swap between two users untouched', async () => {
    const { user } = await createTestUser('editor');
    const { user: other } = await createTestUser('viewer');
    await fileUnder(user.id, `${other.username}-tmp`);
    await fileUnder(other.id, user.username);
    await fileUnder(user.id, other.username);

    await client.query(MIGRATION);

    expect(await localOf(user.id)).toMatchObject([{ providerId: other.username }]);
    expect(await localOf(other.id)).toMatchObject([{ providerId: user.username }]);
  });

  it('leaves a user with several LOCAL identities untouched', async () => {
    const { user } = await createTestUser('editor');
    await fileUnder(user.id, 'old-name');
    await client.query(
      `INSERT INTO identities (id, "userId", provider, "providerId", "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, 'LOCAL', 'older-name', now(), now())`,
      [user.id]
    );

    await client.query(MIGRATION);

    expect((await localOf(user.id)).map(r => r.providerId)).toEqual(['old-name', 'older-name']);
  });
});
