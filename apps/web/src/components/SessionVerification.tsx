'use client';

import { useSessionVerification } from '../hooks/use-session-verification';

/**
 * Invisible component that periodically verifies the session token.
 *
 * Mounts `useSessionVerification`, which polls every 30 seconds and redirects to
 * `/login` automatically if the session has been revoked. Renders nothing.
 */
export function SessionVerification() {
  useSessionVerification();

  // Questo componente non renderizza nulla, serve solo per attivare la verifica
  return null;
}
