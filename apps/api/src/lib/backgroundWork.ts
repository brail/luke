/**
 * Fire-and-forget work a request starts without waiting for it: derivative generation after an
 * upload, the cleanup of a replaced logo. Each task is tracked until it settles, so the tests can
 * wait for it (`backgroundWorkIdle`) instead of letting one test's work land in the next.
 */

import { setImmediate } from 'timers/promises';

/** Tasks `runInBackground` started that have not settled. */
const pendingTasks = new Set<Promise<unknown>>();

/**
 * Runs `task` on the next turn of the event loop, after the caller has returned. The task handles
 * and logs its own errors; one that escapes it, thrown or rejected, is swallowed here so the set
 * never holds it.
 */
export function runInBackground(task: () => Promise<unknown>): void {
  const pending = setImmediate().then(task).catch(() => {});
  pendingTasks.add(pending);
  void pending.finally(() => pendingTasks.delete(pending));
}

/**
 * Resolves once every task `runInBackground` started has settled, those started meanwhile
 * included, and throws if they are still running after `timeoutMs`. For the tests: a task still
 * running after its test writes rows the next test's `TRUNCATE` deadlocks on, and re-creates
 * storage directories under the next test's base path. The default stays below vitest's default
 * hook timeout (10 s), so a stuck task fails with this message, not a generic timeout.
 */
export async function backgroundWorkIdle(timeoutMs = 5_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<true>(resolve => { timer = setTimeout(resolve, timeoutMs, true); });
  try {
    while (pendingTasks.size > 0) {
      if (await Promise.race([Promise.all(pendingTasks).then(() => false), timedOut])) {
        throw new Error(`${pendingTasks.size} background task(s) still running after ${timeoutMs} ms`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
