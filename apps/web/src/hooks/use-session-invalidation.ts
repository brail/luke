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
    // Only if authenticated
    if (status === 'authenticated' && session?.user?.id) {
      debugLog('Start listening for session invalidation notifications');

      // Server-Sent Events for real-time notifications
      const eventSource = new EventSource(
        `/api/session-events?userId=${session.user.id}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'SESSION_INVALIDATED') {
            debugLog('Session invalidated by admin, redirecting to login');
            eventSource.close();
            router.push('/login');
          }
        } catch (error) {
          debugError('Error parsing session notification:', error);
        }
      };

      eventSource.onerror = error => {
        debugError('SSE error:', error);
        // On error, fallback to periodic verification
        eventSource.close();
      };
    }

    // Cleanup when component unmounts or session changes
    return () => {
      if (eventSourceRef.current) {
        debugLog('Stop listening for session invalidation notifications');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [status, session?.user?.id, router]);

  // Cleanup when session changes
  useEffect(() => {
    if (status === 'unauthenticated') {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
  }, [status]);
}
