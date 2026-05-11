'use client';

import type { RouterOutputs } from '@luke/api';
import { COLLECTION_PROGRESS } from '@luke/core';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Progress } from '../../../../../components/ui/progress';

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;


interface CollectionLayoutSummaryProps {
  layout: CollectionLayoutData;
}

export function CollectionLayoutSummary({ layout }: CollectionLayoutSummaryProps) {
  const allRows = layout.groups.flatMap(g => g.rows);
  if (allRows.length === 0) return null;

  const totalSku = allRows.reduce((sum, r) => sum + r.skuForecast, 0);

  // ── Per Progress ──────────────────────────────────────────────────
  const progressStats = [
    ...COLLECTION_PROGRESS.map(progress => {
      const rows = allRows.filter(r => r.progress === progress);
      const sku = rows.reduce((sum, r) => sum + r.skuForecast, 0);
      const qty = rows.reduce((sum, r) => sum + r.qtyForecast, 0);
      const pct = totalSku > 0 ? Math.round((sku / totalSku) * 100) : 0;
      return { label: progress, count: rows.length, sku, qty, pct };
    }),
    (() => {
      const rows = allRows.filter(r => !r.progress);
      const sku = rows.reduce((sum, r) => sum + r.skuForecast, 0);
      const qty = rows.reduce((sum, r) => sum + r.qtyForecast, 0);
      const pct = totalSku > 0 ? Math.round((sku / totalSku) * 100) : 0;
      return { label: '—', count: rows.length, sku, qty, pct };
    })(),
  ].filter(s => s.count > 0);

  // ── Per Fornitore ─────────────────────────────────────────────────
  const vendorMap = new Map<string, { name: string; count: number; sku: number; qty: number }>();
  for (const row of allRows) {
    const key = row.vendor?.id ?? '__none__';
    const name = row.vendor ? (row.vendor.nickname ?? row.vendor.name) : '—';
    const existing = vendorMap.get(key);
    if (existing) {
      existing.count++;
      existing.sku += row.skuForecast;
      existing.qty += row.qtyForecast;
    } else {
      vendorMap.set(key, { name, count: 1, sku: row.skuForecast, qty: row.qtyForecast });
    }
  }
  const vendorStats = Array.from(vendorMap.values()).sort((a, b) => b.sku - a.sku);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Per Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Per Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {progressStats.map(({ label, count, sku, qty, pct }) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {count} righe · {sku} SKU · {qty} paia
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={pct} className="h-1.5 flex-1" />
                <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Per Fornitore */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Per Fornitore</CardTitle>
        </CardHeader>
        <CardContent>
          {vendorStats.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun fornitore assegnato.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left font-normal pb-1.5">Fornitore</th>
                  <th className="text-right font-normal pb-1.5">Righe</th>
                  <th className="text-right font-normal pb-1.5">SKU</th>
                  <th className="text-right font-normal pb-1.5">Paia</th>
                </tr>
              </thead>
              <tbody>
                {vendorStats.map((v, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1.5 font-medium">{v.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{v.count}</td>
                    <td className="py-1.5 text-right tabular-nums">{v.sku}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{v.qty}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-xs font-semibold">
                  <td className="pt-1.5">Totale</td>
                  <td className="pt-1.5 text-right tabular-nums text-muted-foreground">
                    {vendorStats.reduce((s, v) => s + v.count, 0)}
                  </td>
                  <td className="pt-1.5 text-right tabular-nums">
                    {vendorStats.reduce((s, v) => s + v.sku, 0)}
                  </td>
                  <td className="pt-1.5 text-right tabular-nums text-muted-foreground">
                    {vendorStats.reduce((s, v) => s + v.qty, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
