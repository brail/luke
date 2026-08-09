'use client';

import { signOut } from 'next-auth/react';
import { useEffect } from 'react';

import { trpc } from '../lib/trpc';

const HEARTBEAT_INTERVAL_MS = 60_000; // 60 secondi

/**
 * Invisible component that sends a periodic heartbeat and enforces session revocation.
 *
 * Fires `users.heartbeat` every 60 seconds. If the server returns UNAUTHORIZED
 * (e.g. `tokenVersion` was invalidated), it immediately redirects to `/login`
 * without requiring any user interaction. Renders nothing.
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
