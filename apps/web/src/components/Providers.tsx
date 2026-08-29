'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';

import { SseProvider } from '../contexts/SseProvider';
import { TRPCProvider } from '../lib/trpc';

import { MaintenanceGate } from './maintenance/MaintenanceGate';
import { SessionVerification } from './SessionVerification';
import { TimezoneUpdateDialog } from './TimezoneUpdateDialog';
import { TooltipProvider } from './ui/tooltip';

/**
 * Root provider tree for the application.
 *
 * Composes `SessionProvider` (NextAuth), `TRPCProvider` (tRPC + React Query), `SseProvider`
 * (single shared SSE connection, see its own docstring), and mounts global singleton
 * components: `TimezoneUpdateDialog` and `SessionVerification`.
 *
 * A single `TooltipProvider` wraps the tree: `Tooltip.Root` throws without a provider ancestor,
 * so every tooltip in the app depends on this one — see the comment on it.
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
          {/* One provider for the whole app. Radix groups the open delay per provider:
              `skipDelayDuration` is the window in which moving to another tooltip *of the same
              provider* opens it instantly. With one provider per control that grouping never
              applied, so every neighbouring button re-waited the full `delayDuration`. */}
          <TooltipProvider delayDuration={700} skipDelayDuration={300}>
            <MaintenanceGate />
            {children}
            <TimezoneUpdateDialog />
            <SessionVerification />
          </TooltipProvider>
        </SseProvider>
      </TRPCProvider>
    </SessionProvider>
  );
}
