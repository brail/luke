'use client';

import { useSession } from 'next-auth/react';
import React, { createContext, useContext, useState } from 'react';

import { trpc } from '../lib/trpc';

/**
 * Tipo per il context dell'applicazione
 */
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
    year: number;
    name: string;
    isActive: boolean;
  } | null;
  needsSetup: boolean;
  isLoading: boolean;
}

/**
 * Context per gestire lo stato dell'applicazione
 */
const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * Props per AppContextProvider
 */
interface AppContextProviderProps {
  children: React.ReactNode;
}

/**
 * Provider per il context dell'applicazione
 * Carica il context corrente e gestisce lo stato di setup
 */
export function AppContextProvider({ children }: AppContextProviderProps) {
  const { data: session } = useSession();
  const [needsSetup, setNeedsSetup] = useState(false);

  // Query per ottenere il context corrente - solo se autenticato
  const contextQuery = trpc.context.get.useQuery(undefined, {
    retry: false,
    enabled: !!session?.user, // Abilita solo se l'utente è autenticato
  });

  // Gestione errori con useEffect
  React.useEffect(() => {
    if (contextQuery.error?.data?.code === 'PRECONDITION_FAILED') {
      setNeedsSetup(true);
    }
  }, [contextQuery.error]);

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
 * Hook per utilizzare il context dell'applicazione
 * @returns Il context dell'applicazione
 * @throws Error se utilizzato fuori da AppContextProvider
 */
export function useAppContext(): AppContextType {
  const context = useContext(AppContext);

  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppContextProvider');
  }

  return context;
}
