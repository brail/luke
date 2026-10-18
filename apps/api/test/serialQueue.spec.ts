import { describe, expect, it, vi } from 'vitest';

import { createSerialQueue } from '../src/lib/serialQueue';

/**
 * Operations on one queue run one at a time, in submission order. Every case is driven by promises
 * the test settles; the one `setTimeout(0)` turn only lets every task already able to run do so.
 */

const turn = () => new Promise(resolve => setTimeout(resolve, 0));

function held<T>() {
  let release!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

describe('createSerialQueue', () => {
  it('starts an operation only after the previous one settles', async () => {
    const queue = createSerialQueue();
    const first = held<number>();
    const secondStarted = vi.fn();

    const a = queue.run(() => first.promise);
    const b = queue.run(async () => {
      secondStarted();
      return 2;
    });
    await turn();
    expect(secondStarted).not.toHaveBeenCalled();

    first.release(1);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    expect(secondStarted).toHaveBeenCalledOnce();
  });

  it('runs the next operation after one that fails, and reports the failure to its caller only', async () => {
    const queue = createSerialQueue();
    const first = held<number>();

    const a = queue.run(() => first.promise);
    const b = queue.run(async () => 'ran');
    first.fail(new Error('boom'));

    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ran');
  });

  it('keeps separate queues independent', async () => {
    const one = createSerialQueue();
    const two = createSerialQueue();
    const blocked = held<void>();
    const otherRan = vi.fn();

    void one.run(() => blocked.promise);
    await two.run(async () => otherRan());
    expect(otherRan).toHaveBeenCalledOnce();
    blocked.release();
  });
});
