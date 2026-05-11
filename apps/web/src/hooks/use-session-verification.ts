/**
 * Hook per verificare periodicamente la validità della sessione
 * Verifica tokenVersion ogni 30 secondi per rilevare revoca sessioni da admin
 */

import { TRPCClientError } from '@trpc/client';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef } from 'react';

import { debugError, debugLog } from '../lib/debug';
import { trpc } from '../lib/trpc';

export function useSessionVerification() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Query per verificare la sessione (solo se autenticato)
  const { refetch: verifySession } = trpc.me.get.useQuery(undefined, {
    enabled: false, // Non eseguire automaticamente
    retry: false,
    refetchOnWindowFocus: false,
  });

  const verifyImmediately = useCallback(async () => {
    try {
      debugLog('Verifica tokenVersion immediata...');
      const result = await verifySession();

      if (!result.data) {
        debugLog('Sessione invalida rilevata, redirect a login');
        router.push('/login');
        return;
      }
    } catch (error: unknown) {
      const isAuthError =
        error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
      if (isAuthError) {
        debugLog('Sessione invalida rilevata, redirect a login');
        router.push('/login');
      } else {
        debugError('Errore verifica sessione (transiente, ignorato):', error);
      }
    }
  }, [verifySession, router]);

  const handleVisibilityChange = useCallback(() => {
    if (!document.hidden) {
      debugLog('Tab riattivata, verifica sessione...');
      verifyImmediately();
    }
  }, [verifyImmediately]);

  const handleFocus = useCallback(() => {
    debugLog('Window focus, verifica sessione...');
    verifyImmediately();
  }, [verifyImmediately]);

  useEffect(() => {
    if (status === 'authenticated' && session?.accessToken) {
      debugLog('Avvio verifica sessione immediata e periodica');

      verifyImmediately();
      intervalRef.current = setInterval(verifyImmediately, 10000);

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
    }

    // Single cleanup always runs — removeEventListener is a no-op if listener was never added
    return () => {
      if (intervalRef.current) {
        debugLog('Stop verifica periodica sessione');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [status, session?.accessToken, verifyImmediately, handleVisibilityChange, handleFocus]);
}
