/**
 * #228: every user email is stored in one form — trimmed and lowercase — so an address typed with
 * capitals is found again (a password reset reaches it), and the database refuses any other form
 * (`users_email_normalized`, migration `20261116150000_user_email_normalized`).
 *
 * The migration tests seed rows inside one transaction, run the migration file there, read the
 * result and roll back: the test database already holds the migration, so each first drops the
 * constraint inside that transaction to seed the rows it refuses today.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { PRISMA_MIGRATIONS_DIR, type PrismaClient } from '@luke/db';

import * as mailer from '../src/lib/mailer';
import { rateLimitStore } from '../src/lib/ratelimit';
import { appRouter } from '../src/routers/index';

import { createCallerAs, createTestContext, createTestUser, setupTestDb } from './helpers';

const MIGRATION = readFileSync(
  join(PRISMA_MIGRATIONS_DIR, '20261116150000_user_email_normalized', 'migration.sql'),
  'utf8'
);

let prisma: PrismaClient;
let ip = 0;
let resetMails: MockInstance<typeof mailer.sendPasswordResetEmail>;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
  resetMails = vi.spyOn(mailer, 'sendPasswordResetEmail').mockResolvedValue(undefined);
  vi.spyOn(mailer, 'sendEmailVerificationEmail').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function publicAuth() {
  const ctx = createTestContext(null);
  Object.assign(ctx.req, { ip: `10.28.0.${++ip}` });
  return appRouter.createCaller(ctx).auth;
}

describe('a user email is stored in one form', () => {
  it('an address created with capitals is stored lowercase, and a reset typed with capitals reaches it', async () => {
    const admin = await createCallerAs('admin');
    const created = await admin.users.create({
      email: ' Mario.Rossi@Example.IT ',
      username: 'mario.rossi',
      password: 'Initial-Passw0rd!',
      role: 'editor',
    });
    expect(created.email).toBe('mario.rossi@example.it');

    await publicAuth().requestPasswordReset({ email: 'MARIO.ROSSI@example.it' });

    expect(resetMails).toHaveBeenCalledTimes(1);
    expect(resetMails.mock.calls[0]![1]).toBe('mario.rossi@example.it');
  });

  it('an update that changes only the case of the address changes nothing', async () => {
    const { user } = await createTestUser('editor');
    const verifiedAt = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt;
    const admin = await createCallerAs('admin');

    await admin.users.update({ id: user.id, email: user.email.toUpperCase() });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(user.email);
    expect(after.emailVerifiedAt).toEqual(verifiedAt);
  });

  it.each(['Upper@Example.it', ' spaced@example.it', 'màrio@example.it', 'inner space@example.it'])(
    'the database refuses %j',
    async email => {
      const { user } = await createTestUser('editor');

      await expect(prisma.user.update({ where: { id: user.id }, data: { email } })).rejects.toThrow();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
    }
  );
});

describe('migration 20261116150000_user_email_normalized', () => {
  let client: Client | undefined;

  /** Opens the transaction, after the users are created: dropping the constraint locks the table. */
  async function begin() {
    client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    await client.query('ALTER TABLE users DROP CONSTRAINT users_email_normalized');
    return client;
  }

  afterEach(async () => {
    await client?.query('ROLLBACK');
    await client?.end();
    client = undefined;
  });

  const setEmail = (id: string, email: string) => client!.query('UPDATE users SET email = $1 WHERE id = $2', [email, id]);
  const emailOf = async (id: string) =>
    (await client!.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id])).rows[0]!.email;
  const hasConstraint = async () =>
    (await client!.query("SELECT 1 FROM pg_constraint WHERE conname = 'users_email_normalized'")).rowCount === 1;

  it('lowercases and trims every address, adds the constraint, and runs twice', async () => {
    const { user } = await createTestUser('editor');
    const tx = await begin();
    await setEmail(user.id, ' Mixed.Case@Example.IT ');

    await tx.query(MIGRATION);
    expect(await emailOf(user.id)).toBe('mixed.case@example.it');
    expect(await hasConstraint()).toBe(true);

    await tx.query(MIGRATION);
    expect(await emailOf(user.id)).toBe('mixed.case@example.it');
  });

  it('stops, changing nothing, when two users share an address once normalized, inactive ones included', async () => {
    const { user: first } = await createTestUser('editor');
    const { user: second } = await createTestUser('viewer');
    const tx = await begin();
    await tx.query('UPDATE users SET "isActive" = false WHERE id = $1', [second.id]);
    await setEmail(first.id, 'shared@example.it');
    await setEmail(second.id, 'Shared@Example.it');

    await tx.query('SAVEPOINT before');
    await expect(tx.query(MIGRATION)).rejects.toThrow(/2 user\(s\) sharing an address once normalized/);
    await tx.query('ROLLBACK TO SAVEPOINT before');

    expect(await emailOf(second.id)).toBe('Shared@Example.it');
    expect(await hasConstraint()).toBe(false);
  });

  it.each([
    ['a non-ASCII letter', 'màrio@example.it'],
    ['a non-ASCII space trim and btrim disagree on', ' mario@example.it'],
    ['an inner space', 'mario rossi@example.it'],
  ])('stops, changing nothing, on %s', async (_case, email) => {
    const { user } = await createTestUser('editor');
    const tx = await begin();
    await setEmail(user.id, email);

    await tx.query('SAVEPOINT before');
    await expect(tx.query(MIGRATION)).rejects.toThrow(/1 address\(es\) outside printable ASCII/);
    await tx.query('ROLLBACK TO SAVEPOINT before');

    expect(await emailOf(user.id)).toBe(email);
  });
});
