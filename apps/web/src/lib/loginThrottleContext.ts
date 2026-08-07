/**
 * Request-scoped channel between the `[...nextauth]` route wrapper and `authorize()`
 * (`../auth.ts`), which NextAuth invokes internally with no way to return a value the
 * wrapper can read. `AsyncLocalStorage` propagates state through that nested async call
 * without a second network round-trip and without a shared mutable global that would leak
 * across concurrent requests — see `docs/` (o il piano di remediation Strix RC) per il
 * perché: la route deve rispondere 429 quando `auth.login` rifiuta per rate-limit, ma
 * NextAuth risponde sempre 200 su `authorize() → null`, quindi il segnale va fatto uscire
 * dalla call stack in un altro modo.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface LoginThrottleState {
  /** Presence (not just truthiness) is the "was rate-limited" signal — see `isLimited` below. */
  retryAfterSeconds?: number;
}

export const loginThrottleContext = new AsyncLocalStorage<LoginThrottleState>();

/**
 * Called from `callTRPCAuth()` when `auth.login` responds `TOO_MANY_REQUESTS`.
 * No-op outside an active store (e.g. unit tests that call `authorize()` directly without
 * going through the route wrapper) — there is nothing to short-circuit in that case.
 */
export function markLoginThrottled(retryAfterSeconds: number): void {
  const store = loginThrottleContext.getStore();
  if (!store) return;
  store.retryAfterSeconds = retryAfterSeconds;
}

/** Reads a `LoginThrottleState` and reports whether `markLoginThrottled()` was called. */
export function isLimited(state: LoginThrottleState): boolean {
  return state.retryAfterSeconds !== undefined;
}
