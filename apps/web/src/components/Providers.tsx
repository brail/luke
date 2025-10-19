'use client';

import { SessionProvider } from 'next-auth/react';
import React from 'react';

import { TRPCProvider } from '../lib/trpc';

import { SessionVerification } from './SessionVerification';
import { TimezoneUpdateDialog } from './TimezoneUpdateDialog';

/**
 * Provider globale per l'applicazione
 * Combina SessionProvider (Auth.js), TRPCProvider (tRPC + React Query)
 * e componenti globali come TimezoneUpdateDialog e SessionVerification
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
