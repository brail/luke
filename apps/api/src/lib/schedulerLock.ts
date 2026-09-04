/**
 * Postgres-row-based leader lock for tick-based schedulers, so a second API instance
 * (horizontal scale-out) skips a tick instead of running it concurrently with another
 * instance's — prod runs a single API replica today, but nothing stops someone from setting
 * `replicas: 2` in Portainer, and every scheduler in this directory has an in-memory `isRunning`
 * guard that only protects against double-execution *within* one process.
 *
 * Same idiom as `EditLock` (row + `expiresAt`, no session/connection pinning needed — unlike a
 * Postgres advisory lock, which would require pinning one physical connection for the whole tick
 * duration, incompatible with tick internals that call `prisma.$transaction()` themselves).
 * Acquisition is one atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE` — a conditional upsert
 * isn't expressible via Prisma's `upsert()` (no WHERE on the update branch), hence the raw SQL
 * per CLAUDE.md's ORM policy exception for query shapes Prisma can't express.
 *
 * `expiresAt` is a crash-safety ceiling only: the normal path releases the lock explicitly in a
 * `finally` right after the tick completes (deleting the row, see `release`), so a slow tick never
 * blocks the next one — the TTL only matters if a process dies mid-tick without running that
 * `finally` (OOM, kill -9).
 */

import { randomUUID } from 'crypto';

import { Prisma } from '@luke/db';
import type { PrismaClient } from '@luke/db';

import type { Entity } from './navSyncScheduler';

/** Crash-safety ceiling — see module docstring. Generous since normal-path release doesn't wait on it. */
const LOCK_TTL_MS = 15 * 60 * 1000;

/** One random id per process — identifies which instance holds each lock (informational + safe release). */
const INSTANCE_ID = randomUUID();

/**
 * One entry per tick-based scheduler in this directory that mutates shared state (not just a
 * local buffer flush). `nav-sync` has one lock per entity (vendor/brand/season sync independently
 * and can run concurrently with each other — a single shared name would serialize them even
 * within one process) — derived from `navSyncScheduler.ts`'s own `Entity` type rather than
 * listed out by hand, so a future entity added there can't silently miss a lock name here.
 */
export type SchedulerName =
  | 'asset-derivatives'
  | 'backup'
  | 'calendar-digest'
  | 'feedback-sync'
  | 'kimo-sync'
  | 'maintenance-mode'
  | 'milestone-deadline'
  | `nav-sync:${Entity}`
  | 'portafoglio-sync'
  | 'retention-sweep';

async function tryAcquire(prisma: PrismaClient, name: SchedulerName): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ name: string }[]>(Prisma.sql`
    INSERT INTO scheduler_locks (name, "heldBy", "expiresAt")
    VALUES (${name}, ${INSTANCE_ID}, now() + ${LOCK_TTL_MS} * interval '1 millisecond')
    ON CONFLICT (name) DO UPDATE
      SET "heldBy" = EXCLUDED."heldBy", "expiresAt" = EXCLUDED."expiresAt"
      WHERE scheduler_locks."expiresAt" < now()
    RETURNING name
  `);
  return rows.length > 0;
}

async function release(prisma: PrismaClient, name: SchedulerName): Promise<void> {
  // Deletes the row instead of expiring it. Writing `expiresAt = now()` seemed equivalent but
  // isn't: the column is `TIMESTAMP(3)`, so Postgres rounds to the millisecond — including
  // rounding up — while reacquisition requires `expiresAt < now()`. A tick restarting within
  // half a millisecond of the release would find the lock still held and get silently skipped.
  //
  // Only release if still ours — if our TTL already lapsed and another instance re-acquired it
  // in the meantime, this must not clobber their fresh lock.
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM scheduler_locks
    WHERE name = ${name} AND "heldBy" = ${INSTANCE_ID}
  `);
}

/**
 * Wraps a scheduler tick so it only runs if this instance acquires the named lock. Non-blocking:
 * if another instance already holds it, resolves immediately without running `tick` at all —
 * same "skip this tick" semantics as the existing in-memory `isRunning` guards, just cross-instance.
 *
 * **Wrap the actual awaited work, not a fire-and-forget dispatcher.** If your scheduler's tick
 * kicks off work via `void doWork()` instead of `await doWork()` (the pattern in
 * `kimoSyncScheduler.ts`/`portafoglioSyncScheduler.ts`/`navSyncScheduler.ts`, needed there because
 * a sync can outlive the tick interval), wrap `doWork` itself — `withSchedulerLock(prisma, name,
 * doWork)()` — not the outer tick. Wrapping the outer tick in that case is a no-op: the tick
 * returns (and the lock releases) as soon as it fires off `doWork`, before any real work has
 * happened, so two instances can still run the same sync concurrently. Where the tick itself is
 * the awaited unit of work (`backupScheduler.ts`, `calendarDigestScheduler.ts`,
 * `milestoneDeadlineScheduler.ts`, `maintenanceModeScheduler.ts`), wrap it directly.
 *
 * Also put any cheap in-memory/config early-return checks *before* calling this — e.g. compose
 * with `guardMaintenance` as the outer layer, or hoist a tick's own "nothing to do" guard above
 * the call — so a no-op tick (the common case for most of these) doesn't spend two DB round
 * trips taking and releasing a lock it never needed.
 */
export function withSchedulerLock<T>(
  prisma: PrismaClient,
  name: SchedulerName,
  tick: () => Promise<T>,
): () => Promise<T | undefined> {
  return async () => {
    if (!(await tryAcquire(prisma, name))) return undefined;
    try {
      return await tick();
    } finally {
      await release(prisma, name);
    }
  };
}
