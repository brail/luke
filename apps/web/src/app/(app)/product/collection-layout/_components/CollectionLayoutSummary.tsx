'use client';

import type { RouterOutputs } from '@luke/api';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import { Progress } from '../../../../../components/ui/progress';
import { inactiveLabel } from '../../../../../lib/catalogOptions';
import { groupRowsByVendor } from '../../_shared/pricingCalc';
import { useSeasonPhaseOrder } from '../_hooks/useSeasonPhaseOrder';

type CollectionLayoutData = NonNullable<RouterOutputs['collectionLayout']['get']>;

interface CollectionLayoutSummaryProps {
  layout: CollectionLayoutData;
}

function StatLine({ label, detail, pct }: { label: string; detail: string; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <div className="flex items-center gap-2">
        <Progress value={pct} aria-label={label} className="h-1.5 flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
      </div>
    </div>
  );
}

/**
 * Summary cards for a collection layout: per phase, the share of SKU and the
 * share of completed rows; per vendor, rows, SKU and pairs.
 *
 * Returns null when the layout has no rows.
 */
export function CollectionLayoutSummary({ layout }: CollectionLayoutSummaryProps) {
  const { phases, phaseById, rank } = useSeasonPhaseOrder(layout.id);
  const allRows = layout.groups.flatMap(g => g.rows);
  if (allRows.length === 0) return null;

  const totalSku = allRows.reduce((sum, r) => sum + (r.skuForecast ?? 0), 0);

  // ── By phase, in season order (#159) ──────────────────────────
  // Every row lands on one line: the active phases in season order, then any other phase the rows
  // hold — a retired one keeps completed rows (#188) —, then the rows with no phase.
  const rowsByPhase = new Map<string, typeof allRows>();
  const noPhase: typeof allRows = [];
  for (const row of allRows) {
    if (!row.phaseId) {
      noPhase.push(row);
      continue;
    }
    const rows = rowsByPhase.get(row.phaseId);
    if (rows) rows.push(row);
    else rowsByPhase.set(row.phaseId, [row]);
  }
  const phaseStat = (key: string, label: string, rows: typeof allRows) => {
    const sku = rows.reduce((sum, r) => sum + (r.skuForecast ?? 0), 0);
    const qty = rows.reduce((sum, r) => sum + (r.qtyForecast ?? 0), 0);
    const pct = totalSku > 0 ? Math.round((sku / totalSku) * 100) : 0;
    return { key, label, count: rows.length, sku, qty, pct };
  };
  const activeIds = new Set(phases.map(p => p.id));
  const otherPhases = [...rowsByPhase.keys()]
    .filter(id => !activeIds.has(id))
    .map(id => {
      const phase = phaseById.get(id);
      return { id, label: phase ? inactiveLabel(phase.label) : 'Fase sconosciuta' };
    })
    .sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
  const progressStats = [...phases, ...otherPhases]
    .filter(phase => rowsByPhase.has(phase.id))
    .map(phase => phaseStat(phase.id, phase.label, rowsByPhase.get(phase.id) ?? []));
  if (noPhase.length > 0) progressStats.push(phaseStat('none', '—', noPhase));

  // ── Completed rows: a row share, independent of the phase (#181) ──
  const completedCount = allRows.filter(r => r.completedAt).length;
  const completedPct = Math.round((completedCount / allRows.length) * 100);

  // ── By vendor ─────────────────────────────────────────────────────
  const vendorStats = groupRowsByVendor(allRows, '—')
    .map(v => ({
      name: v.name,
      count: v.rows.length,
      sku: v.rows.reduce((sum, r) => sum + (r.skuForecast ?? 0), 0),
      qty: v.rows.reduce((sum, r) => sum + (r.qtyForecast ?? 0), 0),
    }))
    .sort((a, b) => b.sku - a.sku);

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader size="compact">
          <CardTitle size="compact">Per Fase</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {progressStats.map(({ key, label, count, sku, qty, pct }) => (
            <StatLine key={key} label={label} detail={`${count} righe · ${sku} SKU · ${qty} paia`} pct={pct} />
          ))}
          {completedCount > 0 && (
            <div className="border-t pt-3">
              <StatLine label="Righe concluse" detail={`${completedCount} di ${allRows.length} righe`} pct={completedPct} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader size="compact">
          <CardTitle size="compact">Per Fornitore</CardTitle>
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
