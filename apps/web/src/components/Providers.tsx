'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { TRPCProvider } from '../lib/trpc';

/**
 * Provider globale per l'applicazione
 * Combina SessionProvider (Auth.js) e TRPCProvider (tRPC + React Query)
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const TRPCProviderComponent = TRPCProvider as any;
  
  return (
    <SessionProvider>
      <TRPCProviderComponent>{children}</TRPCProviderComponent>
    </SessionProvider>
  );
}
