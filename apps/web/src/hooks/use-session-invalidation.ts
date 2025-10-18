/**
 * Hook per rilevare invalidazione sessioni in tempo reale
 * Utilizza Server-Sent Events (SSE) per notifiche immediate da admin
 */

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function useSessionInvalidation() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Solo se autenticato
    if (status === 'authenticated' && session?.user?.id) {
      console.log('Avvio ascolto notifiche invalidazione sessione');

      // Server-Sent Events per notifiche real-time
      const eventSource = new EventSource(
        `/api/session-events?userId=${session.user.id}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'SESSION_INVALIDATED') {
            console.log('Sessione invalidata da admin, redirect a login');
            eventSource.close();
            router.push('/login');
          }
        } catch (error) {
          console.error('Errore parsing notifica sessione:', error);
        }
      };

      eventSource.onerror = error => {
        console.error('Errore SSE:', error);
        // In caso di errore, fallback alla verifica periodica
        eventSource.close();
      };
    }

    // Cleanup quando il componente si smonta o la sessione cambia
    return () => {
      if (eventSourceRef.current) {
        console.log('Stop ascolto notifiche invalidazione sessione');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [status, session?.user?.id, router]);

  // Cleanup quando la sessione cambia
  useEffect(() => {
    if (status === 'unauthenticated') {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [status]);
}
