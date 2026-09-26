import { TRPCClientError } from '@trpc/client';
import { signOut, useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef } from 'react';

import { debugError, debugLog } from '../lib/debug';
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
    try {
      debugLog('Verifica tokenVersion immediata...');
      const result = await verifySession();

      if (!result.data) {
        forceLogout();
        return;
      }
    } catch (error: unknown) {
      const isAuthError =
        error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
      if (isAuthError) {
        forceLogout();
      } else {
        debugError('Session verification error (transient, ignored):', error);
      }
    }
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
