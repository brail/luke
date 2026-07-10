'use client';

import { useMemo } from 'react';

import { trpc } from '../../../../../lib/trpc';
import { expandDateRangeToIsoDates } from '../../utils';

/**
 * Resolves the set of ISO dates ('YYYY-MM-DD') closed for any of the given vendors in the given
 * season — the union of their `VendorClosurePeriod` ranges, merged the same way `useHolidays`
 * expands holiday ranges. One batched query for every vendor (`holidays.listVendorClosuresBatch`)
 * instead of one query per vendor — no cap on vendor count needed.
 */
export function useVendorClosures(vendorIds: string[], seasonId: string): Set<string> {
  const { data } = trpc.holidays.listVendorClosuresBatch.useQuery(
    { vendorIds, seasonId },
    { enabled: vendorIds.length > 0, staleTime: 30 * 60 * 1000 }
  );

  return useMemo(() => {
    const dates = new Set<string>();
    for (const period of data ?? []) {
      if (period.type !== 'CLOSURE') continue;
      for (const iso of expandDateRangeToIsoDates(new Date(period.startDate), new Date(period.endDate))) {
        dates.add(iso);
      }
    }
    return dates;
  }, [data]);
}
