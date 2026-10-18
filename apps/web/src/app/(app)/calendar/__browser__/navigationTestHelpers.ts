import type { Mock } from 'vitest';

/**
 * Parses the query string a mocked `router.replace` was last called with. A bare
 * `fakeReplace.mock.calls.at(-1) as [string, unknown]` cast fails with an opaque
 * "undefined is not iterable" when `replace` was never called — this throws a message that
 * actually says so.
 */
export function paramsFromLastReplace(fakeReplace: Mock): URLSearchParams {
  const lastCall = fakeReplace.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.replace was never called');
  const [url] = lastCall as [string, unknown];
  return new URLSearchParams(String(url).replace(/^\?/, ''));
}
