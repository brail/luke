/**
 * Listens for real-time session-invalidation events pushed by the server via SSE.
 * When a `SESSION_INVALIDATED` event is received the user is immediately redirected
 * to `/login`. The SSE connection is opened only while the session is authenticated
 * and is closed on unmount or when the session becomes unauthenticated.
 */

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';

import { debugError, debugLog } from '../lib/debug';

export function useSessionInvalidation() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Solo se autenticato
    if (status === 'authenticated' && session?.user?.id) {
      debugLog('Avvio ascolto notifiche invalidazione sessione');

      // Server-Sent Events per notifiche real-time
      const eventSource = new EventSource(
        `/api/session-events?userId=${session.user.id}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'SESSION_INVALIDATED') {
            debugLog('Sessione invalidata da admin, redirect a login');
            eventSource.close();
            router.push('/login');
          }
        } catch (error) {
          debugError('Errore parsing notifica sessione:', error);
        }
      };

      eventSource.onerror = error => {
        debugError('Errore SSE:', error);
        // In caso di errore, fallback alla verifica periodica
        eventSource.close();
      };
    }

    // Cleanup quando il componente si smonta o la sessione cambia
    return () => {
      if (eventSourceRef.current) {
        debugLog('Stop ascolto notifiche invalidazione sessione');
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
