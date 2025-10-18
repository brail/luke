'use client';

import { useSessionVerification } from '../hooks/use-session-verification';

/**
 * Componente per la verifica periodica della sessione
 * Utilizza il hook useSessionVerification per verificare tokenVersion ogni 30s
 * e redirectare automaticamente a login se la sessione è stata revocata
 */
export function SessionVerification() {
  useSessionVerification();

  // Questo componente non renderizza nulla, serve solo per attivare la verifica
  return null;
}
