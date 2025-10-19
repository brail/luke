/**
 * Hook per verificare periodicamente la validità della sessione
 * Verifica tokenVersion ogni 30 secondi per rilevare revoca sessioni da admin
 */

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    // Solo se autenticato e abbiamo accessToken
    if (status === 'authenticated' && session?.accessToken) {
      console.log('Avvio verifica sessione immediata e periodica');

      // Verifica immediata al mount
      const verifyImmediately = async () => {
        try {
          console.log('Verifica tokenVersion immediata...');
          const result = await verifySession();

          if (!result.data) {
            console.log('Sessione invalida rilevata, redirect a login');
            router.push('/login');
            return;
          }
        } catch (error) {
          console.error('Errore verifica sessione:', error);
          console.log('Sessione invalida rilevata, redirect a login');
          router.push('/login');
          return;
        }
      };

      // Verifica immediata
      verifyImmediately();

      // Verifica ogni 10 secondi (più aggressivo)
      intervalRef.current = setInterval(verifyImmediately, 10000);

      // Verifica quando l'utente torna alla tab (focus/visibility change)
      const handleVisibilityChange = () => {
        if (!document.hidden) {
          console.log('Tab riattivata, verifica sessione...');
          verifyImmediately();
        }
      };

      const handleFocus = () => {
        console.log('Window focus, verifica sessione...');
        verifyImmediately();
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);

      // Cleanup event listeners
      return () => {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
        window.removeEventListener('focus', handleFocus);
      };
    }

    // Cleanup interval quando il componente si smonta o la sessione cambia
    return () => {
      if (intervalRef.current) {
        console.log('Stop verifica periodica sessione');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status, session?.accessToken, verifySession, router]);

  // Cleanup quando la sessione cambia
  useEffect(() => {
    if (status === 'unauthenticated') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [status]);
}
