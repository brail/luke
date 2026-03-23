'use client';

import { signOut } from 'next-auth/react';
import { useEffect } from 'react';

import { trpc } from '../lib/trpc';

const HEARTBEAT_INTERVAL_MS = 60_000; // 60 secondi

/**
 * Componente silenzioso che:
 * 1. Invia un heartbeat periodico per segnalare che l'utente è online
 * 2. Rileva immediatamente la revoca della sessione (tokenVersion invalidato)
 *    e forza il logout senza bisogno di interazione utente
 */
export function HeartbeatTicker() {
  const { mutate } = trpc.users.heartbeat.useMutation({
    onError: error => {
      if (error.data?.code === 'UNAUTHORIZED') {
        signOut({ callbackUrl: '/login' });
      }
    },
  });

  useEffect(() => {
    mutate();
    const id = setInterval(() => mutate(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return null;
}
