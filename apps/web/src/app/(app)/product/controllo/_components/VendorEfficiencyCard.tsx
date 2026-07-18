'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../../../../components/ui/chart';
import {
  MARGIN_STATUS_TEXT_CLASS,
  computeMarginStatus,
  computeWeightedMargin,
  getReferenceOptimalMargin,
  groupRowsByVendor,
} from '../../_shared/pricingCalc';

import type { CollectionStatsCardProps } from './CollectionStatistics';

const chartConfig: ChartConfig = {
  efficiency: { label: 'Paia per SKU', color: 'hsl(var(--chart-1))' },
};

/**
 * Requisito 3: efficienza teorica (qtyForecast / skuForecast) per riga, aggregata
 * per fornitore. Aggregazione come rapporto di somme (Σqty / Σsku), non media dei
 * rapporti — evita che poche righe a bassissimo SKU distorcano la media (stile
 * Simpson's paradox). Bonus: margine medio per fornitore accanto, per confronto
 * efficienza↔margine. Righe senza qtyForecast o skuForecast sono escluse dal
 * rapporto (contate altrove, vedi DataQualityScoreboard).
 */
export function VendorEfficiencyCard({ rows, parameterSets }: CollectionStatsCardProps) {
  const referenceOptimalMargin = getReferenceOptimalMargin(parameterSets);

  const { chartData, overallEfficiency } = useMemo(() => {
    let totalQty = 0;
    let totalSku = 0;

    const data = groupRowsByVendor(rows)
      .map(v => {
        let qty = 0;
        let sku = 0;
        for (const row of v.rows) {
          if (row.qtyForecast != null && row.skuForecast != null && row.skuForecast > 0) {
            qty += row.qtyForecast;
            sku += row.skuForecast;
            totalQty += row.qtyForecast;
            totalSku += row.skuForecast;
          }
        }
        const margin = computeWeightedMargin(v.rows, parameterSets);
        return {
          vendor: v.name,
          sku,
          efficiency: sku > 0 ? Math.round((qty / sku) * 100) / 100 : 0,
          margin,
          marginStatus: margin !== null ? computeMarginStatus(margin * 100, referenceOptimalMargin) : null,
        };
      })
      .filter(v => v.sku > 0)
      .sort((a, b) => b.efficiency - a.efficiency);

    return {
      chartData: data,
      overallEfficiency: totalSku > 0 ? Math.round((totalQty / totalSku) * 100) / 100 : null,
    };
  }, [rows, parameterSets, referenceOptimalMargin]);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader size="compact">
          <CardTitle size="compact">Efficienza per Fornitore</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nessuna riga con SKU e Qty Forecast valorizzati.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader size="compact">
        <CardTitle size="compact">Efficienza per Fornitore</CardTitle>
        <CardDescription>
          Paia prodotti per SKU (Σqty / Σsku){overallEfficiency !== null ? ` — media layout: ${overallEfficiency}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartContainer
          config={chartConfig}
          className="lg:col-span-2 w-full"
          style={{ height: `${chartData.length * 2.25 + 1.5}rem` }}
        >
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis
              type="category"
              dataKey="vendor"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={110}
              tickFormatter={(value: string) => (value.length > 16 ? `${value.slice(0, 15)}…` : value)}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {overallEfficiency !== null && (
              <ReferenceLine x={overallEfficiency} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
            )}
            <Bar dataKey="efficiency" fill="var(--color-efficiency)" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="efficiency" position="right" fontSize={11} />
            </Bar>
          </BarChart>
        </ChartContainer>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium mb-2">Margine medio</p>
          {chartData.map(v => (
            <div key={v.vendor} className="flex items-center justify-between text-sm gap-2">
              <span className="truncate text-muted-foreground">{v.vendor}</span>
              <span className={v.marginStatus ? MARGIN_STATUS_TEXT_CLASS[v.marginStatus] : 'text-muted-foreground/40'}>
                {v.margin !== null ? `${(v.margin * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
