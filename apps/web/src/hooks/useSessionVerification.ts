import { signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef } from 'react';

import { debugLog } from '../lib/debug';
import { trpc } from '../lib/trpc';

/**
 * Periodically verifies the current session's validity by checking the user's
 * `tokenVersion` via `trpc.me.get`. Triggers an immediate check on mount,
 * then re-runs every 10 s, on tab visibility change, and on window focus.
 * Redirects to `/login` when the session is detected as invalid (UNAUTHORIZED).
 */
export function useSessionVerification() {
  const { data: session, status } = useSession();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against the 10s interval racing a focus/visibility-triggered check
  // and firing signOut() (and its redirect) more than once.
  const loggedOutRef = useRef(false);

  // Query that verifies the session (only when authenticated)
  const { refetch: verifySession } = trpc.me.get.useQuery(undefined, {
    enabled: false, // Do not run automatically
    retry: false,
    refetchOnWindowFocus: false,
  });

  const forceLogout = useCallback(() => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    debugLog('Invalid session detected, logging out and redirecting to login');
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    signOut({ callbackUrl: '/login' });
  }, []);

  const verifyImmediately = useCallback(async () => {
    if (loggedOutRef.current) return;
    debugLog('Verifica tokenVersion immediata...');
    // `refetch` resolves with `{ data, error }` and never throws. Only UNAUTHORIZED means a
    // revoked session: a 429, a 5xx or a network error is transient, and the query keeps its last
    // data on error, so `data` says nothing about this check.
    const { error } = await verifySession();
    if (error?.data?.code === 'UNAUTHORIZED') forceLogout();
  }, [verifySession, forceLogout]);

  const handleVisibilityChange = useCallback(() => {
    if (!document.hidden) {
      debugLog('Tab reactivated, verifying session...');
      verifyImmediately();
    }
  }, [verifyImmediately]);

  const handleFocus = useCallback(() => {
    debugLog('Window focus, verifying session...');
    verifyImmediately();
  }, [verifyImmediately]);

  useEffect(() => {
    if (status === 'authenticated' && session?.accessToken) {
      debugLog('Starting immediate and periodic session verification');

      verifyImmediately();
      intervalRef.current = setInterval(verifyImmediately, 10000);

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
    }

    // Single cleanup always runs — removeEventListener is a no-op if listener was never added
    return () => {
      if (intervalRef.current) {
        debugLog('Stopping periodic session verification');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [status, session?.accessToken, verifyImmediately, handleVisibilityChange, handleFocus]);
}
