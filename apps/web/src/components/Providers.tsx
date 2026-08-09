'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';

import { SseProvider } from '../contexts/SseProvider';
import { TRPCProvider } from '../lib/trpc';

import { MaintenanceGate } from './maintenance/MaintenanceGate';
import { SessionVerification } from './SessionVerification';
import { TimezoneUpdateDialog } from './TimezoneUpdateDialog';

/**
 * Root provider tree for the application.
 *
 * Composes `SessionProvider` (NextAuth), `TRPCProvider` (tRPC + React Query), `SseProvider`
 * (single shared SSE connection, see its own docstring), and mounts global singleton
 * components: `TimezoneUpdateDialog` and `SessionVerification`.
 *
 * `MaintenanceGate` renders before `{children}` (unlike the other singletons, which are
 * portal/dialog-style and position-agnostic) so its banner sits above the entire app,
 * including the sidebar layout — a true site-wide notice bar, not a per-page one.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TRPCProvider>
        <SseProvider>
          <MaintenanceGate />
          {children}
          <TimezoneUpdateDialog />
          <SessionVerification />
        </SseProvider>
      </TRPCProvider>
    </SessionProvider>
  );
}
