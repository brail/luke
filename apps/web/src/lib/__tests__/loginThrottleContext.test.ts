/**
 * Contratto di `markLoginThrottled`: deve restare un no-op silenzioso fuori da un contesto
 * `AsyncLocalStorage` attivo (altrimenti ogni chiamata a `callTRPCAuth` fuori dal wrapper della
 * route — es. in un test futuro — lancerebbe), e deve scrivere nello store corretto quando
 * chiamata dentro `loginThrottleContext.run()`, incluso da un punto annidato più in profondità
 * nella call stack — esattamente il caso reale (`authorize()` chiamato da NextAuth dentro
 * `handlers.POST`, a sua volta dentro `route.ts`'s `loginThrottleContext.run()`).
 */

import { describe, it, expect } from 'vitest';

import { isLimited, loginThrottleContext, markLoginThrottled } from '../loginThrottleContext';

describe('markLoginThrottled', () => {
  it('non fa nulla fuori da un contesto AsyncLocalStorage attivo', () => {
    expect(() => markLoginThrottled(60)).not.toThrow();
  });

  it('scrive nello store corrente quando chiamata dentro run()', async () => {
    const result = await loginThrottleContext.run({}, async () => {
      markLoginThrottled(42);
      return loginThrottleContext.getStore();
    });

    expect(result).toEqual({ retryAfterSeconds: 42 });
  });

  it('scrive nello store anche se chiamata da una funzione annidata (async call stack)', async () => {
    async function nestedAuthorizeLike() {
      // Simula authorize() invocato da NextAuth dentro handlers.POST, più in profondità
      // nella call stack rispetto a dove run() è stato aperto.
      markLoginThrottled(15);
    }

    const store = await loginThrottleContext.run({}, async () => {
      await nestedAuthorizeLike();
      return loginThrottleContext.getStore();
    });

    expect(store).toEqual({ retryAfterSeconds: 15 });
  });

  it('contesti concorrenti non si influenzano a vicenda', async () => {
    const [resultA, resultB] = await Promise.all([
      loginThrottleContext.run({}, async () => {
        markLoginThrottled(10);
        return loginThrottleContext.getStore();
      }),
      loginThrottleContext.run({}, async () => {
        // Nessuna chiamata a markLoginThrottled: deve restare non limitato.
        return loginThrottleContext.getStore();
      }),
    ]);

    expect(resultA).toEqual({ retryAfterSeconds: 10 });
    expect(resultB).toEqual({});
  });
});

describe('isLimited', () => {
  it('false quando retryAfterSeconds non è stato impostato', () => {
    expect(isLimited({})).toBe(false);
  });

  it('true quando retryAfterSeconds è impostato (anche a 0)', () => {
    expect(isLimited({ retryAfterSeconds: 30 })).toBe(true);
    expect(isLimited({ retryAfterSeconds: 0 })).toBe(true);
  });
});
