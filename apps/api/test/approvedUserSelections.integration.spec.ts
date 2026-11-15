/**
 * Sets of users chosen by their state go through one definition (`approvedUsers.ts`): active and
 * approved. An account still pending approval is left out of the maintenance notices and emails and
 * of the dashboard count, as it already is of the break-glass count.
 */
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Prisma, PrismaClient } from '@luke/db';

import { DEFAULT_STATE, writeMaintenanceState } from '../src/lib/maintenanceMode';
import { appRouter } from '../src/routers/index';
import { countBreakGlassAdmins } from '../src/services/auth.service';

import { createCallerWithSession, createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  await writeMaintenanceState(prisma, DEFAULT_STATE);
});

afterEach(async () => {
  await writeMaintenanceState(prisma, DEFAULT_STATE);
  vi.restoreAllMocks();
});

async function userWith(role: 'admin' | 'editor' | 'viewer', data: Prisma.UserUpdateInput) {
  const { user } = await createTestUser(role);
  return prisma.user.update({ where: { id: user.id }, data });
}

const PENDING = { pendingApproval: true };

/** An admin caller, an approved editor, a pending and an inactive account. */
async function population() {
  const [admin, { user: editor }, pending] = await Promise.all([
    createTestUser('admin'),
    createTestUser('editor'),
    userWith('editor', PENDING),
    userWith('viewer', { isActive: false }),
  ]);
  const ctx = createTestContext(admin.session);
  return { ctx, caller: appRouter.createCaller(ctx), approved: [admin.user, editor], pending };
}

describe('maintenance emails', () => {
  const sentTo = new Set<string>();

  beforeEach(() => {
    sentTo.clear();
    // Every send fails, so `emailUsers` logs `{ failed, total }` once the whole fan-out has settled:
    // the signal that no send is still on its way.
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: vi.fn(async (options: { to: string }) => {
        sentTo.add(options.to);
        throw new Error('refused');
      }),
      close: vi.fn(),
    } as never); // Only what `sendEmail` calls of a transport.
  });

  function fanOutSettled(error: ReturnType<typeof vi.spyOn>) {
    return vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.objectContaining({ failed: expect.any(Number) }), expect.any(String)), { timeout: 10_000 });
  }

  async function withSmtp(caller: ReturnType<typeof appRouter.createCaller>) {
    await caller.integrations.mail.saveConfig({
      host: 'smtp.test', port: 587, secure: false, user: 'mailer', pass: 'smtp-password',
      from: 'luke@example.com', baseUrl: 'https://luke.example.com',
    });
  }

  it('on scheduling, notify and email only the approved users', async () => {
    const { ctx, caller, approved, pending } = await population();
    await withSmtp(caller);
    const error = vi.spyOn(ctx.logger, 'error');

    await caller.maintenance.mode.schedule({
      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      notifyByEmail: true,
    });

    await fanOutSettled(error);
    expect([...sentTo].sort()).toEqual(approved.map(u => u.email).sort());
    // One insert per zone, and every account here reads in the same zone: once the approved users'
    // rows exist, the pending account's would too.
    await vi.waitFor(async () => {
      expect(await prisma.notification.count({ where: { userId: { in: approved.map(u => u.id) } } })).toBe(approved.length);
    });
    expect(await prisma.notification.count({ where: { userId: pending.id } })).toBe(0);
  });

  it('on ending, email only the approved users', async () => {
    const { ctx, caller, approved } = await population();
    await withSmtp(caller);
    await writeMaintenanceState(prisma, { ...DEFAULT_STATE, status: 'ACTIVE', activatedAt: new Date().toISOString(), notifyByEmail: true });
    const error = vi.spyOn(ctx.logger, 'error');

    await caller.maintenance.mode.end();

    await fanOutSettled(error);
    expect([...sentTo].sort()).toEqual(approved.map(u => u.email).sort());
  });
});

describe('counts', () => {
  it('the dashboard counts approved users only', async () => {
    const admin = await createTestUser('admin');
    const caller = createCallerWithSession(admin.session);
    const { users: before } = await caller.dashboard.getKpiStats();

    await Promise.all([userWith('editor', PENDING), userWith('viewer', { isActive: false })]);

    expect((await caller.dashboard.getKpiStats()).users).toBe(before);
  });

  it('break-glass counts an approved administrator, not a pending one', async () => {
    await Promise.all([createTestUser('admin'), userWith('admin', PENDING)]);

    await expect(countBreakGlassAdmins(prisma)).resolves.toBe(1);
  });
});
