'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { ChartContainer, ChartTooltip, type ChartConfig } from '../../../../../components/ui/chart';
import { formatMoqCoverageRatio, MOQ_COVERAGE_THRESHOLD, type MoqCluster } from '../../../../../lib/moqCoverage';
import { cn } from '../../../../../lib/utils';

import type { TooltipProps } from 'recharts';

export const MOQ_STATUS_LABEL = { below: 'Critico', covered: 'Non critico' } as const;

// Colours only: the tooltip and the legend are custom and read MOQ_STATUS_LABEL.
const chartConfig = {
  below: { color: 'hsl(var(--status-critical))' },
  covered: { color: 'hsl(var(--muted-foreground))' },
} satisfies ChartConfig;

const AXIS_STYLE = { tickLine: false, axisLine: false, fontSize: 11 } as const;

/** Round A/B values for the log axes: recharts generates no ticks for a log scale. */
const RATIO_TICKS = [0.1, 0.25, 0.5, 0.7, 1, 1.5, 2, 3, 5, 10, 20];

const formatRatio = (ratio: number) => ratio.toLocaleString('it-IT', { maximumFractionDigits: 2 });
export const formatInteger = (value: number) => value.toLocaleString('it-IT');

const clusterLabel = (c: MoqCluster) => [c.gender, c.category, c.pricePositioning, c.strategy].join(' · ');

export type PlottedCluster = MoqCluster & { ratio: number };

/** The log-scale views draw only a positive ratio; the table and the heatmap show every cluster. */
export const plottable = (clusters: MoqCluster[]) => clusters.filter((c): c is PlottedCluster => (c.ratio ?? 0) > 0);

/** Signed distance from the threshold on a log scale, negative below it. */
const thresholdOffset = (c: PlottedCluster) => Math.log(c.ratio / MOQ_COVERAGE_THRESHOLD);

function ClusterTooltip({ active, payload }: TooltipProps<number, string>) {
  // recharts types the hovered datum as `any`; every series in this file plots MoqCluster objects.
  const cluster = payload?.[0]?.payload as MoqCluster | undefined;
  if (!active || !cluster) return null;
  return (
    <div className="space-y-0.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{clusterLabel(cluster)}</p>
      <p className="text-muted-foreground">
        SKU {formatInteger(cluster.sku)} · A {formatInteger(cluster.forecastPairs)} paia · B{' '}
        {formatInteger(cluster.minimumPairs)} paia
      </p>
      <p>
        A/B {formatMoqCoverageRatio(cluster)} — {cluster.belowMoq ? MOQ_STATUS_LABEL.below : MOQ_STATUS_LABEL.covered}
      </p>
    </div>
  );
}

/** One legend for the three views, so the status never rests on colour alone. */
export function MoqStatusLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-status-critical" />
        {MOQ_STATUS_LABEL.below} (A/B &lt; {formatRatio(MOQ_COVERAGE_THRESHOLD)})
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground" />
        {MOQ_STATUS_LABEL.covered}
      </span>
    </div>
  );
}

/** X = SKU (crowding), Y = A/B on a log scale, bubble area = A (pairs). */
export function ClusterBubbleChart({ points }: { points: PlottedCluster[] }) {
  const { below, covered, domain, ticks } = useMemo(() => {
    const ratios = [MOQ_COVERAGE_THRESHOLD, ...points.map(c => c.ratio)];
    // Padding on a log axis is multiplicative; the threshold always stays in view.
    const lo = Math.min(...ratios) / 1.5;
    const hi = Math.max(...ratios) * 1.5;
    return {
      below: points.filter(c => c.belowMoq),
      covered: points.filter(c => !c.belowMoq),
      domain: [lo, hi],
      ticks: RATIO_TICKS.filter(t => t >= lo && t <= hi),
    };
  }, [points]);

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-96 w-full">
      <ScatterChart margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey="sku" name="SKU" allowDecimals={false} {...AXIS_STYLE} />
        <YAxis
          type="number"
          dataKey="ratio"
          name="A/B"
          scale="log"
          domain={domain}
          ticks={ticks}
          tickFormatter={formatRatio}
          width={40}
          {...AXIS_STYLE}
        />
        <ZAxis type="number" dataKey="forecastPairs" range={[60, 900]} />
        <ReferenceLine y={MOQ_COVERAGE_THRESHOLD} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
        <ChartTooltip cursor={false} content={ClusterTooltip} />
        <Scatter data={covered} fill="var(--color-covered)" fillOpacity={0.7} stroke="hsl(var(--background))" strokeWidth={2} />
        <Scatter data={below} fill="var(--color-below)" fillOpacity={0.85} stroke="hsl(var(--background))" strokeWidth={2} />
      </ScatterChart>
    </ChartContainer>
  );
}

/** One bar per cluster in table order, diverging from the threshold on a log scale. */
export function ClusterDivergingBars({ points }: { points: PlottedCluster[] }) {
  const { extent, ticks } = useMemo(() => {
    // Symmetric around the threshold, at least ×2 either way so clusters close to it still read.
    const max = Math.max(Math.log(2), ...points.map(c => Math.abs(thresholdOffset(c)))) * 1.1;
    return {
      extent: max,
      ticks: RATIO_TICKS.map(r => Math.log(r / MOQ_COVERAGE_THRESHOLD)).filter(t => Math.abs(t) <= max),
    };
  }, [points]);

  // One bar per cluster: the height follows the data, which no static class can express.
  const height = `${points.length * 2 + 3}rem`;

  return (
    <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={points} layout="vertical" margin={{ left: 8, right: 56 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis
          type="number"
          domain={[-extent, extent]}
          ticks={ticks}
          tickFormatter={(offset: number) => formatRatio(MOQ_COVERAGE_THRESHOLD * Math.exp(offset))}
          {...AXIS_STYLE}
        />
        <YAxis
          type="category"
          dataKey={clusterLabel}
          width={200}
          {...AXIS_STYLE}
          tickFormatter={(value: string) => (value.length > 32 ? `${value.slice(0, 31)}…` : value)}
        />
        <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
        <ChartTooltip cursor={false} content={ClusterTooltip} />
        <Bar dataKey={thresholdOffset}>
          {points.map(c => (
            <Cell key={c.key} fill={c.belowMoq ? 'var(--color-below)' : 'var(--color-covered)'} />
          ))}
          <LabelList dataKey="sku" position="right" fontSize={11} formatter={(sku: number) => `SKU ${sku}`} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Rows = category, columns = gender · positioning · strategy combinations present. */
export function ClusterHeatmap({ clusters }: { clusters: MoqCluster[] }) {
  const { columns, rows, cells } = useMemo(() => {
    const columnsByKey = new Map<string, MoqCluster>();
    const rowsByKey = new Map<string, string>();
    const cellsByKey = new Map<string, MoqCluster>();
    for (const c of clusters) {
      const columnKey = JSON.stringify([c.gender, c.pricePositioning, c.strategy]);
      const rowKey = c.category.toLowerCase();
      if (!columnsByKey.has(columnKey)) columnsByKey.set(columnKey, c);
      if (!rowsByKey.has(rowKey)) rowsByKey.set(rowKey, c.category);
      cellsByKey.set(JSON.stringify([rowKey, columnKey]), c);
    }
    return {
      columns: [...columnsByKey].sort(([a], [b]) => a.localeCompare(b)),
      rows: [...rowsByKey].sort(([, a], [, b]) => a.localeCompare(b)),
      cells: cellsByKey,
    };
  }, [clusters]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium">Categoria</th>
            {columns.map(([key, c]) => (
              <th key={key} className="px-2 py-2 text-center text-xs font-medium">
                <div>{c.gender}</div>
                <div className="text-muted-foreground">{c.pricePositioning}</div>
                <div className="text-muted-foreground">{c.strategy}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([rowKey, label]) => (
            <tr key={rowKey} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{label}</td>
              {columns.map(([columnKey]) => {
                const cell = cells.get(JSON.stringify([rowKey, columnKey]));
                return (
                  <td key={columnKey} className="p-1">
                    {cell ? (
                      <div
                        className={cn(
                          'rounded px-2 py-1 text-center tabular-nums',
                          cell.belowMoq ? 'bg-status-critical/20' : 'bg-muted',
                        )}
                      >
                        <div className="font-medium">{formatMoqCoverageRatio(cell)}</div>
                        <div className="text-xs text-muted-foreground">SKU {formatInteger(cell.sku)}</div>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground/40">·</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
