'use client';

import { useSession } from 'next-auth/react';
import { useMemo } from 'react';

import { trpc } from '../lib/trpc';

/**
 * Hook per verificare l'accesso a brand e stagioni per l'utente corrente.
 *
 * Whitelist model:
 * - brandIds === null  → nessuna restrizione, tutti i brand accessibili
 * - brandIds === []    → nessun brand accessibile (caso teorico)
 * - brandIds === [id…] → solo quei brand
 *
 * Per le stagioni, il whitelist è per-brand:
 * - seasonIds per quel brand === null → tutte le stagioni di quel brand
 * - seasonIds per quel brand === [id…] → solo quelle stagioni
 */
export function useContextAccess() {
  const { data: session } = useSession();

  const { data } = trpc.context.access.getForMe.useQuery(undefined, {
    enabled: !!session?.user,
    retry: false,
  });

  return useMemo(() => {
    const brandIds = data?.brandIds ?? null;
    const brandSeasonRows = data?.brandSeasonRows ?? [];

    const canAccessBrand = (brandId: string): boolean => {
      if (brandIds === null) return true;
      return brandIds.includes(brandId);
    };

    const canAccessSeason = (brandId: string, seasonId: string): boolean => {
      // Prima verifica che il brand sia accessibile
      if (!canAccessBrand(brandId)) return false;

      const seasonIdsForBrand = brandSeasonRows
        .filter(r => r.brandId === brandId)
        .map(r => r.seasonId);

      if (seasonIdsForBrand.length === 0) return true; // nessuna restrizione
      return seasonIdsForBrand.includes(seasonId);
    };

    return {
      /** null = tutti i brand accessibili, altrimenti whitelist */
      allowedBrandIds: brandIds,
      canAccessBrand,
      canAccessSeason,
    };
  }, [data]);
}
