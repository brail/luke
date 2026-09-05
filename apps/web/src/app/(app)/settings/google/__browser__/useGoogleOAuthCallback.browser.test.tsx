import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { useGoogleOAuthCallback } from '../useGoogleOAuthCallback';

/**
 * Regression test for the real `useGoogleOAuthCallback` production hook (not a reimplementation
 * of it). The hook carries a complete, honest dependency array — no eslint suppression — and
 * relies entirely on its own `handledRef` guard for idempotency. These tests prove that guard
 * holds across actual re-renders that hand it brand-new `searchParams`/mutation/`toast` object
 * references each time (exactly what would otherwise re-trigger the effect), rather than relying
 * on the array being incomplete to prevent re-entry.
 *
 * The guard's fixes were verified during development by temporarily reverting `handledRef`'s
 * pending-mutation handling and confirming the corresponding test below fails against that
 * reverted shape, then reverting the mutation — that evidence lives in the development record,
 * not as a section in this file.
 *
 * `window.history.replaceState` is stubbed for every test in this file (`beforeEach`/`afterEach`
 * below), never left to call through: the production hook under test really does call it on a
 * successful code exchange, and a call-through would change the real browser test runner's own
 * URL — affecting whatever runs after it, in this file or (in a shared-page test runner) beyond
 * it. Restoring in `afterEach` (rather than at the end of the one test that asserts on it) means
 * the stub comes off even when an earlier assertion in that test throws first.
 */

function spyOnReplaceState() {
  return vi.spyOn(window.history, 'replaceState');
}

let replaceStateSpy: ReturnType<typeof spyOnReplaceState>;

beforeEach(() => {
  replaceStateSpy = spyOnReplaceState().mockImplementation(() => {});
});

afterEach(() => {
  replaceStateSpy.mockRestore();
});

function freshSearchParams(values: Record<string, string>) {
  // A NEW object every call — matches the real Next.js contract (a new URLSearchParams-like
  // value per navigation) that used to force excluding this parameter from the deps array.
  return { get: (key: string) => values[key] ?? null };
}

function freshMutation(isPending: boolean, mutate: (input: { code: string; redirectUri: string }) => void) {
  // A NEW object every call — matches the real, verified-unstable useMutation() shape.
  return { isPending, mutate };
}

function freshToast(error: (message: string) => void) {
  // A NEW object every call — matches useToast()'s unmemoized return value.
  return { error };
}

function Harness({
  values,
  mutate,
  toastError,
  isPending = false,
}: {
  values: Record<string, string>;
  mutate: (input: { code: string; redirectUri: string }) => void;
  toastError: (message: string) => void;
  isPending?: boolean;
}) {
  useGoogleOAuthCallback(freshSearchParams(values), freshMutation(isPending, mutate), freshToast(toastError));
  return <div>rendered</div>;
}

describe('useGoogleOAuthCallback (production hook) — idempotency guard', () => {
  test('exchanges a present code exactly once, even across re-renders with brand-new object identities', async () => {
    const mutateSpy = vi.fn();
    const toastErrorSpy = vi.fn();
    const values = { oauth_code: 'one-time-code' };

    const screen = await render(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} />);
    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledWith({ code: 'one-time-code', redirectUri: expect.stringContaining('/api/google/oauth/callback') });
    expect(replaceStateSpy).toHaveBeenCalled();

    // Re-render several times with brand-new searchParams/mutation/toast objects each time
    // (every Harness render calls fresh*() again) — simulates unrelated parent re-renders, the
    // mutation settling, and toast's own per-render object churn all at once.
    for (let i = 0; i < 3; i++) {
      await screen.rerender(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} />);
    }
    // No new call should have appeared. `vi.waitFor` doesn't prove that — it isn't watching for
    // a change that might still happen after this line, it just polls until the assertion passes
    // or the timeout elapses. The actual guarantee that there's nothing left in flight to catch
    // comes from each `await screen.rerender(...)` above: vitest-browser-react wraps it in
    // `act(async () => {...})`, which flushes React's effects (this hook's included) before the
    // promise resolves, so the mutation call count is already settled by the time this check runs.
    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledTimes(1);
  });

  test('notifies oauth_error exactly once across re-renders with brand-new object identities', async () => {
    const mutateSpy = vi.fn();
    const toastErrorSpy = vi.fn();
    const values = { oauth_error: 'access_denied' };

    const screen = await render(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} />);
    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(1));
    expect(toastErrorSpy).toHaveBeenCalledWith('Autorizzazione Google negata');
    expect(mutateSpy).not.toHaveBeenCalled();

    for (let i = 0; i < 3; i++) {
      await screen.rerender(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} />);
    }
    await vi.waitFor(() => expect(toastErrorSpy).toHaveBeenCalledTimes(1));
    expect(toastErrorSpy).toHaveBeenCalledTimes(1);
  });

  test('does nothing when neither oauth_code nor oauth_error is present, across re-renders', async () => {
    const mutateSpy = vi.fn();
    const toastErrorSpy = vi.fn();
    const screen = await render(<Harness values={{}} mutate={mutateSpy} toastError={toastErrorSpy} />);

    for (let i = 0; i < 3; i++) {
      await screen.rerender(<Harness values={{}} mutate={mutateSpy} toastError={toastErrorSpy} />);
    }
    expect(mutateSpy).not.toHaveBeenCalled();
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  test('handles a code that only arrives on a LATER render (mounts without it first)', async () => {
    const mutateSpy = vi.fn();
    const toastErrorSpy = vi.fn();

    const screen = await render(<Harness values={{}} mutate={mutateSpy} toastError={toastErrorSpy} />);
    expect(mutateSpy).not.toHaveBeenCalled();

    // The code "arrives" — e.g. the router finished resolving query params after mount.
    await screen.rerender(<Harness values={{ oauth_code: 'late-code' }} mutate={mutateSpy} toastError={toastErrorSpy} />);
    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledWith({ code: 'late-code', redirectUri: expect.stringContaining('/api/google/oauth/callback') });

    // And still only once after that.
    await screen.rerender(<Harness values={{ oauth_code: 'late-code' }} mutate={mutateSpy} toastError={toastErrorSpy} />);
    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledTimes(1);
  });

  test('a code seen while the mutation is already pending is exchanged once it frees up, not dropped', async () => {
    const mutateSpy = vi.fn();
    const toastErrorSpy = vi.fn();
    const values = { oauth_code: 'code-during-pending' };

    // First render: the mutation is already in flight (e.g. a prior unrelated call). The guard
    // must NOT close here, or this code would never get exchanged once the mutation frees up.
    const screen = await render(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} isPending />);
    expect(mutateSpy).not.toHaveBeenCalled();

    // The mutation settles — a fresh, non-pending mutation object, exactly like a real
    // useMutation() transitioning isPending: true -> false.
    await screen.rerender(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} isPending={false} />);
    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledWith({ code: 'code-during-pending', redirectUri: expect.stringContaining('/api/google/oauth/callback') });

    // And still only once after that.
    await screen.rerender(<Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} isPending={false} />);
    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledTimes(1);
  });

  test('StrictMode double-invokes this effect on mount — the guard still exchanges the code once', async () => {
    // React Strict Mode (dev only) mounts, unmounts and remounts every component once, running
    // every effect twice against the SAME initial render — the exact scenario `handledRef` is
    // documented to defend against (see the production hook's own doc comment). Without the
    // guard, the second invocation would see the same `oauth_code` still present and call
    // `exchangeMutation.mutate` a second time.
    const mutateSpy = vi.fn();
    const toastErrorSpy = vi.fn();
    const values = { oauth_code: 'strict-mode-code' };

    await render(
      <StrictMode>
        <Harness values={values} mutate={mutateSpy} toastError={toastErrorSpy} />
      </StrictMode>
    );

    await vi.waitFor(() => expect(mutateSpy).toHaveBeenCalledTimes(1));
    expect(mutateSpy).toHaveBeenCalledWith({ code: 'strict-mode-code', redirectUri: expect.stringContaining('/api/google/oauth/callback') });
    expect(mutateSpy).toHaveBeenCalledTimes(1);
  });
});
