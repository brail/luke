/**
 * A new user reads dates in the business zone (ADR-035 §New users). The column's database default —
 * a second copy of the zone — gave every new user Europe/Rome whatever `app.defaultTimezone` said.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { deleteConfig, saveConfig } from '../src/lib/configManager';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let caller: ReturnType<typeof createCallerWithSession>;

beforeAll(async () => {
  prisma = await setupTestDb();
  caller = createCallerWithSession((await createTestUser('admin')).session);
  await saveConfig(prisma, 'app.defaultTimezone', 'Asia/Shanghai');
});

afterAll(async () => {
  await deleteConfig(prisma, 'app.defaultTimezone');
});

describe('users.create', () => {
  it('gives the new user the business zone', async () => {
    const uid = randomUUID().slice(0, 8);
    const user = await caller.users.create({ username: `tz-${uid}`, email: `tz-${uid}@test.com`, password: 'SecurePassword123!', role: 'viewer' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { timezone: true } })).timezone).toBe('Asia/Shanghai');
  });
});
