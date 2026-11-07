import { afterEach, describe, expect, it, vi } from 'vitest';

import { runInBackground } from '../backgroundWork';
import { closeAll } from '../gracefulShutdown';

import type { FastifyInstance } from 'fastify';

/**
 * Records the shutdown steps in `events`; `warn` is the logger the late-task message goes to. The
 * server close takes `closeMs` of the faked clock.
 */
function fakeDeps(events: string[], closeMs = 0) {
  const warn = vi.fn();
  const fastify = {
    close: async () => {
      if (closeMs > 0) vi.setSystemTime(Date.now() + closeMs);
      events.push('close');
    },
    log: { warn, error: vi.fn() },
  };
  return {
    warn,
    deps: {
      // closeAll uses only `close` and the logger's `warn` and `error`.
      fastify: fastify as unknown as FastifyInstance,
      prisma: { $disconnect: async () => { events.push('disconnect'); } },
      shutdownTelemetry: async () => {},
    },
  };
}

describe('closeAll and background work', () => {
  let release: () => void = () => {};

  afterEach(() => {
    vi.useRealTimers();
    // Settled here, or the global `afterEach` in `test/setup.ts` would fail on it.
    release();
  });

  it('disconnects the database only after pending background work settles', async () => {
    const events: string[] = [];
    let started = false;
    runInBackground(() => new Promise<void>(resolve => {
      started = true;
      release = () => { events.push('task'); resolve(); };
    }));
    const { deps } = fakeDeps(events);

    const closing = closeAll(deps);
    await expect.poll(() => started && events.includes('close')).toBe(true);
    release();

    await expect(closing).resolves.toBe(true);
    expect(events).toEqual(['close', 'task', 'disconnect']);
  });

  it.each([
    { closeMs: 0, waitMs: 4_000 },
    // A slow server close leaves less: the wait still ends 1 s before the 5 s budget.
    { closeMs: 2_500, waitMs: 1_500 },
  ])('gives up a late task after $waitMs ms when the close takes $closeMs ms, and disconnects', async ({ closeMs, waitMs }) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const events: string[] = [];
    runInBackground(() => new Promise<void>(resolve => { release = resolve; }));
    const { deps, warn } = fakeDeps(events, closeMs);

    const closing = closeAll(deps);
    await vi.advanceTimersByTimeAsync(waitMs - 1);
    expect(warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(closing).resolves.toBe(true);
    expect(events).toEqual(['close', 'disconnect']);
    expect(warn).toHaveBeenCalledWith(`Background work given up at shutdown: 1 background task(s) still running after ${waitMs} ms`);
  });
});
