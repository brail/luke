/**
 * What the section guard does with each answer of the access check: an error is not a denial, and
 * the section renders on neither.
 */

import { TRPCClientError } from '@trpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  auth: vi.fn(),
  // As Next's: it throws, so nothing after it runs.
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  // Outside a server render React's own `cache` is unavailable.
  cache: <T>(fn: T) => fn,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('../../../auth', () => ({ auth: h.auth }));
vi.mock('../../../lib/trpcAuth', () => ({
  createAuthedTrpcClient: () => ({ sectionAccess: { getEffectiveForMe: { query: h.query } } }),
}));

const { assertSectionAccess } = await import('../assertSectionAccess');

// `TRPCClientError` keeps the response shape it is given; the guard reads only `data.code`.
const trpcError = (code: string) => TRPCClientError.from({ error: { code: -1, message: code, data: { code } } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: 'u1' }, accessToken: 't' });
});

describe('assertSectionAccess', () => {
  it('lets a granted section through', async () => {
    h.query.mockResolvedValue({ settings: true });

    await expect(assertSectionAccess('settings')).resolves.toBeUndefined();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it('sends a denied section to the dashboard', async () => {
    h.query.mockResolvedValue({ settings: false });

    await expect(assertSectionAccess('settings')).rejects.toThrow('redirect:/dashboard');
  });

  it('sends a revoked session through the forced logout', async () => {
    h.query.mockRejectedValue(trpcError('UNAUTHORIZED'));

    await expect(assertSectionAccess('settings')).rejects.toThrow('redirect:/api/auth/force-logout');
  });

  it.each([
    ['a rate limit', trpcError('TOO_MANY_REQUESTS')],
    ['a server error', trpcError('INTERNAL_SERVER_ERROR')],
    ['a network error', new TypeError('fetch failed')],
  ])('throws on %s, with no redirect', async (_label, failure) => {
    h.query.mockRejectedValue(failure);

    await expect(assertSectionAccess('settings')).rejects.toBe(failure);
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
