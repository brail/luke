'use client';

import { useSession } from 'next-auth/react';
import React, { createContext, useContext, useState } from 'react';

import { trpc } from '../lib/trpc';

/** Shape of the application context available via `useAppContext()`. */
interface AppContextType {
  brand: {
    id: string;
    code: string;
    name: string;
    logoUrl: string | null;
    isActive: boolean;
  } | null;
  season: {
    id: string;
    code: string;
    year: number | null;
    name: string;
    isActive: boolean;
  } | null;
  needsSetup: boolean;
  isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppContextProviderProps {
  children: React.ReactNode;
}

/**
 * Provides the global application context (active brand and season) to the React tree.
 * Fetches the current context from `trpc.context.get` when the user is authenticated.
 * Sets `needsSetup = true` when the API returns `PRECONDITION_FAILED` (no context configured).
 */
export function AppContextProvider({ children }: AppContextProviderProps) {
  const { data: session } = useSession();
  const [needsSetup, setNeedsSetup] = useState(false);

  // Query per ottenere il context corrente - solo se autenticato
  const contextQuery = trpc.context.get.useQuery(undefined, {
    retry: false,
    enabled: !!session?.user, // Abilita solo se l'utente è autenticato
  });

  // Gestione errori e reset setup
  React.useEffect(() => {
    if (contextQuery.error?.data?.code === 'PRECONDITION_FAILED') {
      setNeedsSetup(true);
    } else if (contextQuery.data) {
      setNeedsSetup(false);
    }
  }, [contextQuery.error, contextQuery.data]);

  const contextValue: AppContextType = {
    brand: contextQuery.data?.brand || null,
    season: contextQuery.data?.season || null,
    needsSetup,
    isLoading: contextQuery.isLoading,
  };

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
}

/**
 * Returns the current application context (brand, season, loading state).
 *
 * @throws {Error} When called outside of `AppContextProvider`.
 */
export function useAppContext(): AppContextType {
  const context = useContext(AppContext);

  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppContextProvider');
  }

  return context;
}
