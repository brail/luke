'use client';

import { useMemo } from 'react';

import { useSectionAccess } from './useSectionAccess';

/**
 * Hook per verificare l'accesso ai menu della sidebar
 * Mostra una macrosezione solo se ha almeno una voce di menu abilitata
 */
export function useMenuAccess() {
  const sectionAccess = useSectionAccess();

  const menuAccess = useMemo(() => {
    // Macrosezione "Generale" - mostra solo se Dashboard è accessibile
    const hasGeneralItems = sectionAccess.dashboard;

    // Macrosezione "Sistema" - mostra solo se almeno una delle voci è accessibile
    const hasSystemItems = sectionAccess.settings || sectionAccess.maintenance;

    return {
      // Controllo per singole voci (per i dropdown)
      dashboard: sectionAccess.dashboard,
      settings: sectionAccess.settings,
      maintenance: sectionAccess.maintenance,

      // Controllo per macrosezioni
      showGeneralSection: hasGeneralItems,
      showSystemSection: hasSystemItems,
    };
  }, [sectionAccess]);

  return menuAccess;
}
