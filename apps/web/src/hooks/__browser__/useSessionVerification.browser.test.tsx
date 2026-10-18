import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { useSessionVerification } from '../useSessionVerification';

/**
 * The periodic session check signs out on `UNAUTHORIZED` and on nothing else. It used to sign out
 * whenever its first check after a page load returned no data: a hard reload of a photo-heavy
 * collection layout spent the API's per-IP budget, the check got a 429, and the user landed on
 * the login page (rc.1). TanStack Query's `refetch` resolves with `{ data, error }`, never throws.
 */

type CheckResult = { data: unknown; error: unknown };

const { refetch, signOut } = vi.hoisted(() => ({
  refetch: vi.fn<() => Promise<CheckResult>>(),
  signOut: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  signOut,
  useSession: () => ({ data: { accessToken: 'session-token' }, status: 'authenticated' }),
}));
vi.mock('../../lib/trpc', () => ({
  trpc: { me: { get: { useQuery: () => ({ refetch }) } } },
}));

const ME = { id: 'user-1' };
const UNAUTHORIZED = { data: { code: 'UNAUTHORIZED' } };
// What `httpBatchStreamLink` builds from the global limiter's 429 body: no `data.code`.
const RATE_LIMITED = { message: 'Too many requests from 10.0.0.1', data: undefined };

async function mountWithChecks(...results: CheckResult[]): Promise<void> {
  for (const result of results) refetch.mockResolvedValueOnce(result);
  function Harness() {
    useSessionVerification();
    return null;
  }
  await render(<Harness />);
  await expect.poll(() => refetch.mock.calls.length).toBeGreaterThanOrEqual(1);
}

/** Runs one more check the way a returning user does, by focusing the window. */
async function checkAgain(): Promise<void> {
  const before = refetch.mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  await expect.poll(() => refetch.mock.calls.length).toBe(before + 1);
}

describe('useSessionVerification', () => {
  beforeEach(() => {
    refetch.mockReset();
    signOut.mockReset();
  });

  test.each([
    ['a 429 from the rate limiter', RATE_LIMITED],
    ['a network error', new TypeError('fetch failed')],
    ['a server error', { data: { code: 'INTERNAL_SERVER_ERROR' } }],
  ])('keeps the session on %s', async (_, error) => {
    await mountWithChecks({ data: undefined, error });
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(signOut).not.toHaveBeenCalled();
  });

  test('signs out when the first check is UNAUTHORIZED', async () => {
    await mountWithChecks({ data: undefined, error: UNAUTHORIZED });

    await expect.poll(() => signOut.mock.calls.length).toBe(1);
  });

  test('signs out on UNAUTHORIZED after a successful check', async () => {
    // The query keeps its last data on error: the old check read `data` and missed this.
    await mountWithChecks({ data: ME, error: null }, { data: ME, error: UNAUTHORIZED });
    await checkAgain();

    await expect.poll(() => signOut.mock.calls.length).toBe(1);
  });
});
