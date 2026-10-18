/**
 * A dashboard task's due date is a calendar day, stored at UTC midnight. An update wrote what it was
 * not sent: `dueDate: null`, so ticking a task lost its due day, and `done: false`, so editing a
 * completed task reopened it.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let caller: ReturnType<typeof createCallerWithSession>;

beforeAll(async () => {
  await setupTestDb();
  const user = await createTestUser('viewer');
  caller = createCallerWithSession(user.session);
});

describe('dashboard.upsertTask — due day', () => {
  it('stores the day, keeps it when the task is ticked and clears it on null', async () => {
    const task = await caller.dashboard.upsertTask({ label: 'Ordine tessuti', dueDate: '2026-03-10' });
    expect(task.dueDate?.toISOString()).toBe('2026-03-10T00:00:00.000Z');

    const ticked = await caller.dashboard.upsertTask({ id: task.id, label: task.label, done: true });
    expect(ticked).toMatchObject({ done: true, dueDate: task.dueDate });

    const cleared = await caller.dashboard.upsertTask({ id: task.id, label: task.label, done: true, dueDate: null });
    expect(cleared.dueDate).toBeNull();
  });

  it('keeps a completed task completed when an update leaves the state out', async () => {
    const task = await caller.dashboard.upsertTask({ label: 'Campionario', done: true });

    expect(await caller.dashboard.upsertTask({ id: task.id, label: 'Campionario FW27' })).toMatchObject({ done: true });
  });
});
