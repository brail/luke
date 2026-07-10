'use client';

import { useMemo } from 'react';

import { trpc } from '../../../../../lib/trpc';
import { expandDateRangeToIsoDates } from '../../utils';

/** Hard cap on distinct vendors checked per step — keeps the hook count fixed (rules of hooks). */
const MAX_VENDOR_SLOTS = 8;

/**
 * Resolves the set of ISO dates ('YYYY-MM-DD') closed for any of the given vendors in the given
 * season — the union of their `VendorClosurePeriod` ranges, merged the same way `useHolidays`
 * expands holiday ranges. Reuses the existing single-vendor `holidays.listVendorClosures` query
 * (fired once per vendor) rather than introducing a new batch endpoint.
 */
export function useVendorClosures(vendorIds: string[], seasonId: string): Set<string> {
  const slots = useMemo(() => vendorIds.slice(0, MAX_VENDOR_SLOTS), [vendorIds]);

  // Fixed number of hook calls regardless of how many vendors are actually present.
  const queries = Array.from({ length: MAX_VENDOR_SLOTS }, (_, i) =>
    trpc.holidays.listVendorClosures.useQuery(
      { vendorId: slots[i] ?? '', seasonId },
      { enabled: !!slots[i], staleTime: 30 * 60 * 1000 }
    )
  );

  return useMemo(() => {
    const dates = new Set<string>();
    for (const q of queries) {
      for (const period of q.data ?? []) {
        if (period.type !== 'CLOSURE') continue;
        for (const iso of expandDateRangeToIsoDates(new Date(period.startDate), new Date(period.endDate))) {
          dates.add(iso);
        }
      }
    }
    return dates;
  }, [queries.map(q => q.dataUpdatedAt).join(',')]);
}
