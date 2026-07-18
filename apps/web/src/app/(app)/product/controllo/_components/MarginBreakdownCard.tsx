'use client';

import { useMemo } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { MARGIN_STATUS_CHART_COLOR, computeRowMargin } from '../../_shared/pricingCalc';

import type { CollectionStatsCardProps } from './CollectionStatistics';

const MISSING_COLOR = 'hsl(var(--muted-foreground) / 0.35)';

/**
 * Requisito 2: quante righe hanno margine in target (verde), vicino al target
 * (giallo), sotto target (rosso), e quante non hanno ancora dati sufficienti
 * per calcolarlo. Riusa computeRowMargin/computeMarginStatus verbatim — nessuna
 * nuova soglia, restano quelle di PricingParameterSet.optimalMargin per riga.
 */
export function MarginBreakdownCard({ rows, parameterSets }: CollectionStatsCardProps) {
  const { segments, total } = useMemo(() => {
    let green = 0, yellow = 0, red = 0, missing = 0;
    for (const row of rows) {
      const m = computeRowMargin(row, parameterSets);
      if (!m) { missing++; continue; }
      if (m.marginStatus === 'green') green++;
      else if (m.marginStatus === 'yellow') yellow++;
      else red++;
    }
    const segs = [
      { key: 'green', label: 'In target', count: green, color: MARGIN_STATUS_CHART_COLOR.green },
      { key: 'yellow', label: 'Vicino al target', count: yellow, color: MARGIN_STATUS_CHART_COLOR.yellow },
      { key: 'red', label: 'Sotto target', count: red, color: MARGIN_STATUS_CHART_COLOR.red },
      { key: 'missing', label: 'Senza dato margine', count: missing, color: MISSING_COLOR },
    ];
    return { segments: segs, total: rows.length };
  }, [rows, parameterSets]);

  return (
    <Card>
      <CardHeader size="compact">
        <CardTitle size="compact">Stato Margine</CardTitle>
        <CardDescription>Righe per stato rispetto al margine target</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {segments.map(s => (
            <div key={s.key} className="space-y-0.5">
              <div className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>
                {s.count}
              </div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
        {total > 0 && (
          <div className="flex h-3 w-full rounded overflow-hidden bg-muted">
            {segments.filter(s => s.count > 0).map(s => (
              <div
                key={s.key}
                style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
                title={`${s.label}: ${s.count}`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
