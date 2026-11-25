/**
 * The notification list pages with a cursor the client sends back — the last item's `createdAt`, an
 * instant. A malformed cursor reached `new Date(cursor)` and failed the query as a server error, and
 * so did a fractional page size.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { sseStore } from '../src/lib/sseStore';

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

// While their stream is open the user's other tabs do not poll (ADR-052): a change of read state
// must reach them as a push, as a new notification does.
describe('notifications — read state reaches the other tabs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['marking one as read', (id: string) => caller.notifications.markAsRead({ id })],
    ['marking all as read', () => caller.notifications.markAllAsRead()],
  ])('%s pushes to the user', async (_name, act) => {
    const unread = await prisma.notification.create({
      data: { userId, category: 'SYSTEM', title: 'Da leggere', message: 'm' },
    });
    const push = vi.spyOn(sseStore, 'pushToUser');

    await act(unread.id);

    expect(push).toHaveBeenCalledWith(userId, { type: 'notification', payload: {} });
  });

  it('archiving the read ones pushes to the user, and a change of nothing pushes nothing', async () => {
    await prisma.notification.updateMany({ where: { userId }, data: { isRead: true } });
    const push = vi.spyOn(sseStore, 'pushToUser');

    await caller.notifications.archiveRead();
    expect(push).toHaveBeenCalledOnce();
    await caller.notifications.archiveRead();
    await caller.notifications.markAllAsRead();
    expect(push).toHaveBeenCalledOnce();
  });
});
