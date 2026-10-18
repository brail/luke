'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { trpc } from '../lib/trpc';

/**
 * Manages the collapsed/expanded state of sidebar accordion menus.
 * State is initialised from `localStorage` for instant UI restore, then
 * reconciled with the DB value from `trpc.users.preferences.menu.get`.
 * Changes are written to `localStorage` immediately and synced to the DB
 * with a 2 s debounce (or immediately when `localStorage` is unavailable).
 * The DB is also flushed synchronously on unmount and before tab/browser close.
 *
 * @returns `{ menuStates, isLoading, toggleMenu }` — call `toggleMenu(key, isOpen)`
 *   to open or close a named menu section (accordion: opening one closes all others).
 */
export function useMenuPreferences() {
  const [menuStates, setMenuStates] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Ref tracking the latest state (for the debounce)
  const latestStatesRef = useRef<Record<string, boolean>>({});
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Query DB al mount
  const { data: dbStates } = trpc.users.preferences.menu.get.useQuery();

  // Mutation that saves to the database
  const { mutate: saveToDb } = trpc.users.preferences.menu.set.useMutation();

  // Initialize from localStorage + DB
  useEffect(() => {
    const stored: Record<string, boolean> = {};

    // Load from localStorage (menus default to open)
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
          // Default: menu open
          stored[key] = true;
        }
      });
    } else {
      // In SSR, everything defaults to open
      menuKeys.forEach((key) => {
        stored[key] = true;
      });
    }

    // Sync with the DB if available
    if (dbStates) {
      Object.assign(stored, dbStates);
      // Update localStorage with the DB values
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

  // Flush to the DB (on logout/unload, or if localStorage is unavailable)
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
      // Clear the debounce timer and flush immediately
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      flushToDb();
    };
  }, [flushToDb]);

  // Flush before unload (closing tab/browser)
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
