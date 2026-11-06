import { describe, expect, it } from 'vitest';

import { backgroundWorkIdle, runInBackground } from '../backgroundWork';

describe('backgroundWorkIdle', () => {
  it('resolves only after every task has settled, a rejected one included', async () => {
    let release: () => void = () => {};
    let started = false;
    runInBackground(() => new Promise<void>(resolve => { started = true; release = resolve; }));
    runInBackground(() => Promise.reject(new Error('escaped')));

    let idle = false;
    const waiting = backgroundWorkIdle().then(() => { idle = true; });
    await expect.poll(() => started).toBe(true);
    expect(idle).toBe(false);

    release();
    await waiting;
    expect(idle).toBe(true);
  });

  it('throws when a task is still running at the deadline', async () => {
    let release: () => void = () => {};
    runInBackground(() => new Promise<void>(resolve => { release = resolve; }));

    await expect(backgroundWorkIdle(20)).rejects.toThrow('1 background task(s) still running after 20 ms');
    // Settled here, or the global `afterEach` in `test/setup.ts` would fail on it.
    release();
  });

  it('settles a task that throws before returning a promise', async () => {
    runInBackground(() => { throw new Error('sync'); });

    await backgroundWorkIdle(20);
  });
});
