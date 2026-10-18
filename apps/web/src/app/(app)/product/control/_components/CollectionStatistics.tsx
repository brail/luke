'use client';

import { useMemo } from 'react';

import type { RouterOutputs } from '@luke/api';

import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { trpc } from '../../../../../lib/trpc';
import { useControlLayout } from '../_hooks/useControlLayout';

import { DataQualityScoreboard } from './DataQualityScoreboard';
import { EmptyContextCard } from './EmptyContextCard';
import { MarginBreakdownCard } from './MarginBreakdownCard';
import { PositioningMarginCrosstab } from './PositioningMarginCrosstab';
import { RetailPriceDistributionCard } from './RetailPriceDistributionCard';
import { VendorEfficiencyCard } from './VendorEfficiencyCard';

import type { PricingParameterSet } from '../../_shared/pricingCalc';

export type CollectionStatsRow =
  NonNullable<RouterOutputs['collectionLayout']['get']>['groups'][number]['rows'][number];

/** Shared prop shape for every card in this dashboard — they all consume the same rows +
 * parameterSets pair, just aggregate it differently. */
export interface CollectionStatsCardProps {
  rows: CollectionStatsRow[];
  parameterSets: PricingParameterSet[];
}

/**
 * "Pivot" view of the current Collection Layout: retail price distribution,
 * margin breakdown, efficiency/margin per vendor, data quality,
 * positioning↔margin crosstab. Scoped to the active brand+season, same data
 * source as the main table (`collectionLayout.get`).
 */
export function CollectionStatistics() {
  const { brand, season } = useAppContext();
  const { layout, enabled, contextLoading } = useControlLayout();

  const { data: parameterSets = [] } = trpc.pricing.parameterSets.list.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled: !!brand?.id && !!season?.id }
  );

  // Stable reference across renders so the memoized aggregations in each card below can
  // actually hit their cache instead of recomputing every time a sibling query settles.
  const allRows = useMemo(() => layout?.groups.flatMap(g => g.rows) ?? [], [layout]);

  if (!enabled && !contextLoading) {
    return <EmptyContextCard message="Seleziona un brand e una stagione" />;
  }

  if (!layout) {
    return null;
  }

  if (allRows.length === 0) {
    return <EmptyContextCard message="Nessuna riga in questo layout" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RetailPriceDistributionCard rows={allRows} parameterSets={parameterSets} />
        <MarginBreakdownCard rows={allRows} parameterSets={parameterSets} />
      </div>
      <VendorEfficiencyCard rows={allRows} parameterSets={parameterSets} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DataQualityScoreboard rows={allRows} parameterSets={parameterSets} />
        <PositioningMarginCrosstab rows={allRows} parameterSets={parameterSets} />
      </div>
    </div>
  );
}
