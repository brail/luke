/**
 * The notification list pages with a cursor the client sends back — the last item's `createdAt`, an
 * instant. A malformed cursor reached `new Date(cursor)` and failed the query as a server error, and
 * so did a fractional page size.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let caller: ReturnType<typeof createCallerWithSession>;
let userId: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  const user = await createTestUser('viewer');
  userId = user.session.user.id;
  caller = createCallerWithSession(user.session);
});

describe('notifications.list — paging', () => {
  it('refuses a cursor that is not an instant, and a fractional page size', async () => {
    await expect(caller.notifications.list({ cursor: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.notifications.list({ limit: 2.5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('pages on with the cursor it returned', async () => {
    await prisma.notification.createMany({
      data: [
        { userId, category: 'SYSTEM', title: 'Prima', message: 'm', createdAt: new Date('2026-07-01T10:00:00Z') },
        { userId, category: 'SYSTEM', title: 'Seconda', message: 'm', createdAt: new Date('2026-07-01T11:00:00Z') },
      ],
    });

    const first = await caller.notifications.list({ limit: 1 });
    expect([first.items.map(n => n.title), first.nextCursor]).toEqual([['Seconda'], '2026-07-01T11:00:00.000Z']);
    const next = await caller.notifications.list({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect(next.items.map(n => n.title)).toEqual(['Prima']);
  });
});
