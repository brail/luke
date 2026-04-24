'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { trpc } from '../lib/trpc';

/**
 * Hook per gestire le preferenze di menu collapsibili
 * Memorizza lo stato in localStorage per UX veloce
 * Sincronizza con DB in background con debounce
 */
export function useMenuPreferences() {
  const [menuStates, setMenuStates] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Ref per tracciare lo stato più recente (per debounce)
  const latestStatesRef = useRef<Record<string, boolean>>({});
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Query DB al mount
  const { data: dbStates } = trpc.users.preferences.menu.get.useQuery();

  // Mutation per salvare su DB
  const { mutate: saveToDb } = trpc.users.preferences.menu.set.useMutation();

  // Inizializza da localStorage + DB
  useEffect(() => {
    const stored: Record<string, boolean> = {};

    // Carica da localStorage (predefinito è true per menu aperti)
    const menuKeys = [
      'vendite',
      'prodotto',
      'amministrazione',
      'impostazioni',
      'manutenzione',
    ];

    if (typeof window !== 'undefined' && window.localStorage) {
      menuKeys.forEach((key) => {
        const value = window.localStorage.getItem(`luke-menu-${key}`);
        if (value !== null) {
          stored[key] = JSON.parse(value);
        } else {
          // Default: menu aperto
          stored[key] = true;
        }
      });
    } else {
      // In SSR, default tutti aperti
      menuKeys.forEach((key) => {
        stored[key] = true;
      });
    }

    // Sincronizza con DB se disponibile
    if (dbStates) {
      Object.assign(stored, dbStates);
      // Aggiorna localStorage con i valori del DB
      if (typeof window !== 'undefined' && window.localStorage) {
        Object.entries(dbStates).forEach(([key, value]) => {
          window.localStorage.setItem(`luke-menu-${key}`, JSON.stringify(value));
        });
      }
    }

    setMenuStates(stored);
    latestStatesRef.current = stored;
    setIsLoading(false);
  }, [dbStates]);

  // Flush a DB (per logout/unload o se localStorage non disponibile)
  const flushToDb = useCallback(() => {
    if (Object.keys(latestStatesRef.current).length > 0) {
      saveToDb(latestStatesRef.current);
    }
  }, [saveToDb]);

  const toggleMenu = useCallback(
    (menuKey: string, isOpen: boolean) => {
      const prev = latestStatesRef.current;
      const newStates = { ...prev };
      // Accordion: close all others when opening one
      if (isOpen) {
        Object.keys(newStates).forEach(k => { newStates[k] = false; });
      }
      newStates[menuKey] = isOpen;

      setMenuStates(newStates);
      latestStatesRef.current = newStates;

      const hasLocalStorage = typeof window !== 'undefined' && window.localStorage;
      if (hasLocalStorage) {
        // Only write keys whose values changed
        Object.entries(newStates).forEach(([k, v]) => {
          if (prev[k] !== v) window.localStorage.setItem(`luke-menu-${k}`, JSON.stringify(v));
        });
      }

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      // Debounce DB sync by 2s if localStorage available; sync immediately otherwise
      const syncDelay = hasLocalStorage ? 2000 : 0;
      debounceTimer.current = setTimeout(() => {
        saveToDb(latestStatesRef.current);
      }, syncDelay);
    },
    [saveToDb]
  );

  // Flush su unmount (logout/navigazione)
  useEffect(() => {
    return () => {
      // Cancella il debounce timer e flush immediatamente
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      flushToDb();
    };
  }, [flushToDb]);

  // Flush prima di unload (chiusura tab/browser)
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushToDb();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      };
    }
  }, [flushToDb]);

  return {
    menuStates,
    isLoading,
    toggleMenu,
  };
}
