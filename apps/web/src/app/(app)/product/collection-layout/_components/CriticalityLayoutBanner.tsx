'use client';

import { useMemo } from 'react';

import { Badge } from '../../../../../components/ui/badge';
import { Card, CardContent } from '../../../../../components/ui/card';
import { trpc } from '../../../../../lib/trpc';

interface Props {
  collectionLayoutId: string;
}

/**
 * Aggregate criticality summary for the whole layout — the only way to see "how many rows are
 * late/urgent" today is scanning per-row badges in the table or leaving the page for the
 * Controllo dashboard. Shares the `criticalityForLayout` query cache with `CollectionGroupSection`
 * (same query key), so this doesn't add an extra fetch.
 *
 * Renders nothing if no row currently has an active phase (calendar not set up yet, or every row
 * has already completed all applicable phases).
 */
export function CriticalityLayoutBanner({ collectionLayoutId }: Props) {
  const { data } = trpc.phaseAlert.criticalityForLayout.useQuery(
    { collectionLayoutId },
    { staleTime: 60 * 1000 }
  );

  // Matches the memoized-grouping pattern CollectionGroupSection uses for its own rowId lookup
  // Map (same query, different aggregation) — avoids rebuilding this on every unrelated re-render.
  const counts = useMemo(() => {
    const map = new Map<string, { label: string; color: string; count: number }>();
    for (const row of data ?? []) {
      const existing = map.get(row.band.label);
      if (existing) existing.count++;
      else map.set(row.band.label, { label: row.band.label, color: row.band.color, count: 1 });
    }
    return map;
  }, [data]);

  if (counts.size === 0) return null;

  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Criticità collezione:</span>
        {Array.from(counts.values()).map(({ label, color, count }) => (
          <Badge key={label} variant="outline" style={{ color, borderColor: color }}>
            {count} {label}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
