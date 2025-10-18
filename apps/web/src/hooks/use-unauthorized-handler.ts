'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

/**
 * Hook per gestire errori UNAUTHORIZED globalmente
 * Intercetta tutti gli errori tRPC e gestisce logout automatico
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   useUnauthorizedHandler(); // Aggiungi questo hook
 *   // ... resto del componente
 * }
 * ```
 */
export function useUnauthorizedHandler() {
  const { data: session } = useSession();

  useEffect(() => {
    if (!session?.accessToken) return;

    // Gestione errori UNAUTHORIZED tramite interceptor globale
    // Questo hook è mantenuto per compatibilità ma la gestione
    // degli errori è ora gestita direttamente nei componenti
    console.log(
      'useUnauthorizedHandler: Hook attivo per sessione',
      session.user?.email
    );
  }, [session?.accessToken, session?.user?.email]);
}
