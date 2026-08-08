'use client';

import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../../components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../../../../../components/ui/chart';
import { trpc } from '../../../../../lib/trpc';
import { UNASSIGNED_POSITIONING_KEY, computeRowRetailPrice } from '../../_shared/pricingCalc';

import type { CollectionStatsCardProps, CollectionStatsRow } from './CollectionStatistics';

const CHART_SLOT_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

/** "Nice" bin step (Heckbert-style) so bin edges read as round numbers, not raw min/max fractions. */
function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

function computeNiceBins(min: number, max: number, targetBinCount: number): { min: number; step: number; count: number } {
  if (min === max) return { min: Math.floor(min), step: Math.max(1, Math.ceil(min * 0.1)), count: 1 };
  const range = niceNumber(max - min, false);
  const step = niceNumber(range / (targetBinCount - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  return { min: niceMin, step, count: Math.round((niceMax - niceMin) / step) };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/**
 * Requisito 1: distribuzione righe per fascia di prezzo retail, con evidenza del
 * posizionamento (stacked per pricePositioning) e conteggio righe senza prezzo.
 * Bin dinamici calcolati dai dati effettivi — nessuna soglia hardcoded, si adatta
 * a qualunque brand/valuta.
 */
export function RetailPriceDistributionCard({ rows, parameterSets }: CollectionStatsCardProps) {
  const { data: positioningCatalog = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'pricePositioning' },
    { staleTime: 5 * 60 * 1000 }
  );

  const { chartData, chartConfig, missingCount, mixedCurrencyCount, currency } = useMemo(() => {
    const computed = rows.map(row => ({ row, retail: computeRowRetailPrice(row, parameterSets) }));
    const withPrice = computed.filter((c): c is { row: CollectionStatsRow; retail: NonNullable<typeof c.retail> } => c.retail !== null);
    const missing = computed.length - withPrice.length;

    // Dominant currency across the season's rows — absolute retail values across different
    // currencies aren't comparable, so rows priced in a minority currency are counted apart
    // rather than silently blended into the wrong bucket.
    const currencyCounts = new Map<string, number>();
    for (const { retail } of withPrice) {
      currencyCounts.set(retail.currency, (currencyCounts.get(retail.currency) ?? 0) + 1);
    }
    const dominant = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const inCurrency = withPrice.filter(c => c.retail.currency === dominant);
    const mixed = withPrice.length - inCurrency.length;

    const config: ChartConfig = {
      [UNASSIGNED_POSITIONING_KEY]: { label: 'Non assegnato', color: 'hsl(var(--muted-foreground))' },
    };
    positioningCatalog.forEach((opt, i) => {
      config[slugify(opt.value)] = { label: opt.label, color: CHART_SLOT_COLORS[i % CHART_SLOT_COLORS.length] };
    });

    if (inCurrency.length === 0) {
      return { chartData: [], chartConfig: config, missingCount: missing, mixedCurrencyCount: mixed, currency: dominant };
    }

    const values = inCurrency.map(c => c.retail.retailPrice);
    const { min, step, count } = computeNiceBins(Math.min(...values), Math.max(...values), 5);

    const bins = Array.from({ length: count }, (_, i) => {
      const lo = min + i * step;
      const hi = lo + step;
      const label = `${Math.round(lo)}–${Math.round(hi)}`;
      const bin: Record<string, number | string> = { bin: label };
      for (const key of Object.keys(config)) bin[key] = 0;
      return bin;
    });

    for (const { row, retail } of inCurrency) {
      const idx = Math.min(count - 1, Math.max(0, Math.floor((retail.retailPrice - min) / step)));
      const key = row.pricePositioning ? slugify(row.pricePositioning) : UNASSIGNED_POSITIONING_KEY;
      const target = bins[idx];
      target[key] = ((target[key] as number) ?? 0) + 1;
    }

    return { chartData: bins, chartConfig: config, missingCount: missing, mixedCurrencyCount: mixed, currency: dominant };
  }, [rows, parameterSets, positioningCatalog]);

  const stackKeys = Object.keys(chartConfig);

  return (
    <Card>
      <CardHeader size="compact">
        <CardTitle size="compact">Distribuzione Prezzo Retail</CardTitle>
        <CardDescription>
          Righe per fascia di prezzo{currency ? ` (${currency})` : ''}, colorate per posizionamento
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-3 text-sm">
          {missingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
              {missingCount} righe senza prezzo retail
            </span>
          )}
          {mixedCurrencyCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {mixedCurrencyCount} righe in valuta diversa (escluse dal grafico)
            </span>
          )}
        </div>

        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nessuna riga con prezzo retail impostato.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="bin" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {stackKeys.map(key => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="positioning"
                  fill={`var(--color-${key})`}
                  radius={key === stackKeys[stackKeys.length - 1] ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
