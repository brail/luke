'use client';

import { useMemo } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { trpc } from '../../../../../lib/trpc';
import {
  MARGIN_STATUS_TEXT_CLASS,
  UNASSIGNED_POSITIONING_KEY,
  computeMarginStatus,
  computeWeightedMargin,
  getReferenceOptimalMargin,
} from '../../_shared/pricingCalc';

import type { CollectionStatsCardProps, CollectionStatsRow } from './CollectionStatistics';

/**
 * Bonus: margine medio per fascia di posizionamento — evidenzia mismatch
 * strategici (es. righe "LUXURY" con margine sotto target, colorato in rosso).
 */
export function PositioningMarginCrosstab({ rows, parameterSets }: CollectionStatsCardProps) {
  const { data: positioningCatalog = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'pricePositioning' },
    { staleTime: 5 * 60 * 1000 }
  );
  const referenceOptimalMargin = getReferenceOptimalMargin(parameterSets);

  const data = useMemo(() => {
    const groups = new Map<string, CollectionStatsRow[]>();
    for (const row of rows) {
      const key = row.pricePositioning ?? UNASSIGNED_POSITIONING_KEY;
      const arr = groups.get(key) ?? [];
      arr.push(row);
      groups.set(key, arr);
    }

    const orderedKeys = [
      ...positioningCatalog.map(o => o.value).filter(v => groups.has(v)),
      ...(groups.has(UNASSIGNED_POSITIONING_KEY) ? [UNASSIGNED_POSITIONING_KEY] : []),
    ];

    return orderedKeys.map(key => {
      const groupRows = groups.get(key)!;
      const margin = computeWeightedMargin(groupRows, parameterSets);
      const label = key === UNASSIGNED_POSITIONING_KEY
        ? 'Non assegnato'
        : (positioningCatalog.find(o => o.value === key)?.label ?? key);
      return {
        key,
        label,
        count: groupRows.length,
        margin,
        marginStatus: margin !== null ? computeMarginStatus(margin * 100, referenceOptimalMargin) : null,
      };
    });
  }, [rows, parameterSets, positioningCatalog, referenceOptimalMargin]);

  return (
    <Card>
      <CardHeader size="compact">
        <CardTitle size="compact">Positioning × Margine</CardTitle>
        <CardDescription>Margine medio pesato per fascia di posizionamento</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Nessuna riga disponibile.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left font-normal pb-1.5">Posizionamento</th>
                <th className="text-right font-normal pb-1.5">Righe</th>
                <th className="text-right font-normal pb-1.5">Margine medio</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.key} className="border-b last:border-0">
                  <td className="py-1.5 font-medium">{d.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{d.count}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${d.marginStatus ? MARGIN_STATUS_TEXT_CLASS[d.marginStatus] : 'text-muted-foreground/40'}`}>
                    {d.margin !== null ? `${(d.margin * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
