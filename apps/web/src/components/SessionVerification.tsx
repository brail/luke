'use client';

import { useSessionVerification } from '../hooks/useSessionVerification';

/**
 * Invisible component that periodically verifies the session token.
 *
 * Mounts `useSessionVerification`, which polls every 10 seconds and redirects to
 * `/login` automatically if the session has been revoked. Renders nothing.
 */
export function SessionVerification() {
  useSessionVerification();
  return null;
}
