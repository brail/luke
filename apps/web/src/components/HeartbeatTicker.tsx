'use client';

import { useEffect } from 'react';

import { trpc } from '../lib/trpc';

const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Invisible component that sends a periodic heartbeat (presence), every 60 seconds.
 *
 * It is also the revocation fallback when the SSE stream is down: a revoked session answers
 * `sessionEnded`, and the global handler (`createQueryClient`) signs out (ADR-052). Renders nothing.
 */
export function HeartbeatTicker() {
  const { mutate } = trpc.users.heartbeat.useMutation({
    // Offline, fail instead of waiting for the network: a paused mutation is replayed on reconnect,
    // and every missed tick would arrive at once (#239).
    networkMode: 'always',
  });

  useEffect(() => {
    mutate();
    const id = setInterval(() => mutate(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mutate]);

  return null;
}
