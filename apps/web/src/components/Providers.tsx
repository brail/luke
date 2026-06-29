'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';

import { TRPCProvider } from '../lib/trpc';

import { SessionVerification } from './SessionVerification';
import { TimezoneUpdateDialog } from './TimezoneUpdateDialog';

/**
 * Root provider tree for the application.
 *
 * Composes `SessionProvider` (NextAuth), `TRPCProvider` (tRPC + React Query),
 * and mounts global singleton components: `TimezoneUpdateDialog` and `SessionVerification`.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TRPCProvider>
        {children}
        <TimezoneUpdateDialog />
        <SessionVerification />
      </TRPCProvider>
    </SessionProvider>
  );
}
