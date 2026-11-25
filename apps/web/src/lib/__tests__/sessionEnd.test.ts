/**
 * `endSession` signs out once per page, and a failed client sign-out never leaves the tab on a dead
 * session: the page leaves through the server route instead (ADR-052).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ signOut: vi.fn(), debugError: vi.fn() }));
vi.mock('next-auth/react', () => ({ signOut: h.signOut }));
vi.mock('../debug', () => ({ debugError: h.debugError }));

/** The module fresh, so its once-flag starts clear. */
async function load() {
  vi.resetModules();
  return import('../sessionEnd');
}

afterEach(() => {
  vi.unstubAllGlobals();
  h.signOut.mockReset();
});

describe('endSession', () => {
  it('signs out to the login page once, however many times it is asked', async () => {
    h.signOut.mockResolvedValue(undefined);
    const { endSession } = await load();

    endSession();
    endSession();

    expect(h.signOut).toHaveBeenCalledOnce();
    expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });

  it('leaves through the server route when the client sign-out fails', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    h.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    const { endSession } = await load();

    endSession();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/force-logout'));
    expect(h.debugError).toHaveBeenCalledOnce();
  });
});
