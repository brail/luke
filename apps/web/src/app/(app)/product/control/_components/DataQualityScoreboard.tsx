'use client';

import { useMemo } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Progress } from '../../../../../components/ui/progress';
import { computeRowMargin, computeRowRetailPrice } from '../../_shared/pricingCalc';

import type { CollectionStatsCardProps } from './CollectionStatistics';

/**
 * Bonus: % righe a cui manca ciascun campo chiave, ordinato dal più incompleto —
 * pensato per essere azionabile prima di una milestone ("cosa manca da compilare").
 */
export function DataQualityScoreboard({ rows, parameterSets }: CollectionStatsCardProps) {
  const fields = useMemo(() => {
    const total = rows.length;
    let vendor = 0, phase = 0, positioning = 0, retail = 0, margin = 0, sku = 0, qty = 0;

    for (const row of rows) {
      if (!row.vendorId) vendor++;
      if (!row.phaseId) phase++;
      if (!row.pricePositioning) positioning++;
      if (computeRowRetailPrice(row, parameterSets) === null) retail++;
      if (computeRowMargin(row, parameterSets) === null) margin++;
      if (row.skuForecast == null) sku++;
      if (row.qtyForecast == null) qty++;
    }

    const counters = [
      { key: 'vendor', label: 'Fornitore', missing: vendor },
      { key: 'phase', label: 'Fase', missing: phase },
      { key: 'positioning', label: 'Posizionamento prezzo', missing: positioning },
      { key: 'retail', label: 'Prezzo retail', missing: retail },
      { key: 'margin', label: 'Margine calcolabile', missing: margin },
      { key: 'sku', label: 'SKU Forecast', missing: sku },
      { key: 'qty', label: 'Qty Forecast', missing: qty },
    ];

    return counters
      .map(c => ({ ...c, pct: total > 0 ? Math.round((c.missing / total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
  }, [rows, parameterSets]);

  return (
    <Card>
      <CardHeader size="compact">
        <CardTitle size="compact">Qualità Dato</CardTitle>
        <CardDescription>% righe a cui manca ciascun campo</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fields.map(f => (
          <div key={f.key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {f.missing} / {rows.length} righe ({f.pct}%)
              </span>
            </div>
            <Progress
              value={f.pct}
              className="h-1.5 rounded bg-muted"
              indicatorClassName="bg-amber-500/70 dark:bg-amber-500/60"
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
