'use client';

import { SessionProvider } from 'next-auth/react';
import { TRPCProvider } from '../lib/trpc';

/**
 * Provider globale per l'applicazione
 * Combina SessionProvider (Auth.js) e TRPCProvider (tRPC + React Query)
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TRPCProvider>{children}</TRPCProvider>
    </SessionProvider>
  );
}
