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
    const blocked = async () =>
      (
        await holder.query<{ pid: number }>(
          'SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [self!.pid]
        )
      ).rows;
    expect(await blocked()).toEqual([]);

    running = other().then(
      value => ({ status: 'fulfilled', value }) as const,
      reason => ({ status: 'rejected', reason }) as const
    );

    const deadline = Date.now() + 5000;
    for (;;) {
      const now = await blocked();
      if (now.length === 1) break;
      if (now.length > 1) {
        throw new Error(
          `more than one backend waits on the held transaction: ${JSON.stringify(now)}`
        );
      }
      if (Date.now() > deadline)
        throw new Error('nothing waited on the held transaction within 5 s');
      await new Promise(resolve => setTimeout(resolve, 25));
    }

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
