/**
 * A sub-section's layout checks the sub-section itself (#217): with its parent on and the
 * sub-section off — an override or the kill switch, which the API resolves into the same map — its
 * page is not rendered, the nested revision pages of the collection layout included.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  query: vi.fn(),
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
vi.mock('../../../auth', () => ({ auth: async () => ({ user: { id: 'u1' }, accessToken: 't' }) }));
vi.mock('../../../lib/trpcAuth', () => ({
  createAuthedTrpcClient: () => ({ sectionAccess: { getEffectiveForMe: { query: h.query } } }),
}));

const { default: ControlLayout } = await import('../../../app/(app)/product/control/layout');
const { default: CollectionLayoutLayout } = await import('../../../app/(app)/product/collection-layout/layout');

beforeEach(() => vi.clearAllMocks());

describe.each([
  ['product/control', ControlLayout, 'product.control'],
  // Also wraps `revisions/` and `revisions/[revisionId]/`.
  ['product/collection-layout', CollectionLayoutLayout, 'product.collection_layout'],
])('the %s layout', (_path, Layout, leaf) => {
  it('sends the user to the dashboard when the sub-section is off and its parent on', async () => {
    h.query.mockResolvedValue({ product: true, [leaf]: false });

    await expect(Layout({ children: 'page' })).rejects.toThrow('redirect:/dashboard');
  });

  it('renders the page when the sub-section is on', async () => {
    h.query.mockResolvedValue({ product: true, [leaf]: true });

    await expect(Layout({ children: 'page' })).resolves.toBe('page');
    expect(h.redirect).not.toHaveBeenCalled();
  });
});
