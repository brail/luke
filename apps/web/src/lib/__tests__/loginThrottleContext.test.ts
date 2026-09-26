/**
 * Contract of `markLoginThrottled`: it must stay a silent no-op outside an active
 * `AsyncLocalStorage` context (otherwise every `callTRPCAuth` call outside the route wrapper —
 * e.g. in a future test — would throw), and it must write to the right store when called inside
 * `loginThrottleContext.run()`, including from a point nested deeper in the call stack — exactly
 * the real case (`authorize()` called by NextAuth inside `handlers.POST`, itself inside
 * `route.ts`'s `loginThrottleContext.run()`).
 */

import { describe, it, expect } from 'vitest';

import { isLimited, loginThrottleContext, markLoginThrottled } from '../loginThrottleContext';

describe('markLoginThrottled', () => {
  it('does nothing outside an active AsyncLocalStorage context', () => {
    expect(() => markLoginThrottled(60)).not.toThrow();
  });

  it('writes to the current store when called inside run()', async () => {
    const result = await loginThrottleContext.run({}, async () => {
      markLoginThrottled(42);
      return loginThrottleContext.getStore();
    });

    expect(result).toEqual({ retryAfterSeconds: 42 });
  });

  it('writes to the store even when called from a nested function (async call stack)', async () => {
    async function nestedAuthorizeLike() {
      // Simulates authorize() invoked by NextAuth inside handlers.POST, deeper in the call
      // stack than where run() was opened.
      markLoginThrottled(15);
    }

    const store = await loginThrottleContext.run({}, async () => {
      await nestedAuthorizeLike();
      return loginThrottleContext.getStore();
    });

    expect(store).toEqual({ retryAfterSeconds: 15 });
  });

  it('concurrent contexts do not affect each other', async () => {
    const [resultA, resultB] = await Promise.all([
      loginThrottleContext.run({}, async () => {
        markLoginThrottled(10);
        return loginThrottleContext.getStore();
      }),
      loginThrottleContext.run({}, async () => {
        // No call to markLoginThrottled: it must stay unthrottled.
        return loginThrottleContext.getStore();
      }),
    ]);

    expect(resultA).toEqual({ retryAfterSeconds: 10 });
    expect(resultB).toEqual({});
  });
});

describe('isLimited', () => {
  it('false when retryAfterSeconds has not been set', () => {
    expect(isLimited({})).toBe(false);
  });

  it('true when retryAfterSeconds is set (even to 0)', () => {
    expect(isLimited({ retryAfterSeconds: 30 })).toBe(true);
    expect(isLimited({ retryAfterSeconds: 0 })).toBe(true);
  });
});
