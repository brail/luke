/**
 * Holds a transaction open on a connection of its own while another operation runs against the
 * same rows, and proves that operation actually waits on it before letting go. A pending promise
 * alone would not prove it: it could be waiting on the connection pool.
 *
 * `hold` takes the locks inside the held transaction. `other` starts once they are held. When
 * exactly one backend is blocked by the holder (`pg_blocking_pids`, which sees advisory and row
 * locks alike), `meanwhile` runs inside the held transaction, which then commits. Returns
 * `other`'s outcome. The connection is always rolled back or committed and closed, and `other`
 * always drained, a timeout included.
 */

import { Client } from 'pg';
import { expect } from 'vitest';

import { APP_CONFIG_WRITE_LOCK_KEY } from '../../src/lib/configManager';
import { LAST_ADMIN_LOCK_KEY } from '../../src/lib/lastAdminGuard';

export async function whileHeld<T>(
  hold: (holder: Client) => Promise<unknown>,
  other: () => Promise<T>,
  meanwhile: (holder: Client) => Promise<unknown> = async () => undefined
): Promise<PromiseSettledResult<T>> {
  const holder = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await holder.connect();
  let running: Promise<PromiseSettledResult<T>> | undefined;
  let committed = false;
  try {
    await holder.query('BEGIN');
    await hold(holder);
    const {
      rows: [self],
    } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const blocked = () => blockedOn(holder, self!.pid);
    expect(await blocked()).toEqual([]);

    running = other().then(
      value => ({ status: 'fulfilled', value }) as const,
      reason => ({ status: 'rejected', reason }) as const
    );

    await waitUntilBlockedOn(holder, self!.pid);

    await meanwhile(holder);
    await holder.query('COMMIT');
    committed = true;
    const outcome = await running;
    expect(await blocked()).toEqual([]);
    return outcome;
  } finally {
    if (!committed) await holder.query('ROLLBACK').catch(() => undefined);
    await holder.end();
    if (running) await running;
  }
}

/**
 * Resolves once exactly one backend waits on the transaction of backend `holderPid`, read through
 * `observer` (any connection, the holder's own included). Throws when more than one waits, or when
 * none has within 5 s. For a holder `whileHeld` cannot be: a Prisma interactive transaction calling
 * the real writer, whose backend reports its pid with `SELECT pg_backend_pid()`.
 */
export async function waitUntilBlockedOn(observer: Client, holderPid: number): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const now = await blockedOn(observer, holderPid);
    if (now.length === 1) return;
    if (now.length > 1) {
      throw new Error(`more than one backend waits on the held transaction: ${JSON.stringify(now)}`);
    }
    if (Date.now() > deadline) throw new Error('nothing waited on the held transaction within 5 s');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

/** The backends waiting on `holderPid`'s transaction now. */
async function blockedOn(observer: Client, holderPid: number): Promise<{ pid: number }[]> {
  // `pg_stat_activity` is read once per transaction and cached: without clearing it, a backend
  // that connects after the first read (a new pool connection) is never seen waiting.
  await observer.query('SELECT pg_stat_clear_snapshot()');
  const { rows } = await observer.query<{ pid: number }>(
    'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
    [holderPid]
  );
  return rows;
}

/** Holds the last-admin advisory lock (`acquireLastAdminLock`), for `whileHeld`. */
export const holdLastAdminLock = (holder: Client) =>
  holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LAST_ADMIN_LOCK_KEY]);

/** Holds `userId`'s row as `lockUserEmail` does, for `whileHeld`. */
export const holdUserRow = (userId: string) => (holder: Client) =>
  holder.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);

/** Holds the AppConfig write lock (`acquireAppConfigWriteLock`), for `whileHeld`. */
export const holdAppConfigWriteLock = (holder: Client) =>
  holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [APP_CONFIG_WRITE_LOCK_KEY]);
