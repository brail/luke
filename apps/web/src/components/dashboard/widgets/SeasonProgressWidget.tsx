'use client';

import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { trpc } from '../../../lib/trpc';

export function SeasonProgressWidget() {
  const { data, isLoading } = trpc.dashboard.getSeasonProgress.useQuery();

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-5 w-32" />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Avanzamento stagione</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nessun contesto attivo selezionato.</p>
        </CardContent>
      </Card>
    );
  }

  const budgetPct = data.skuBudget && data.skuBudget > 0
    ? Math.min(100, Math.round((data.skuForecast / data.skuBudget) * 100))
    : 0;

  const bars = [
    { label: 'Budget raggiunto',  pct: budgetPct,                         value: `${budgetPct}%`,                              color: 'bg-blue-500'  },
    { label: 'Referenze coperte', pct: data.rowCount > 0 ? 100 : 0,       value: String(data.rowCount),                        color: 'bg-blue-400'  },
    { label: 'Gruppi attivi',     pct: data.groupCount > 0 ? 100 : 0,     value: String(data.groupCount),                      color: 'bg-green-500' },
    { label: 'SKU forecast',      pct: budgetPct,                         value: data.skuForecast.toLocaleString('it-IT'),      color: 'bg-amber-500' },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Avanzamento stagione</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 px-2.5 py-0.5 text-xs font-medium">
            {data.brandName} {data.seasonName}
          </span>
          <span className="text-sm text-muted-foreground">Campagna ordini attiva</span>
        </div>

        <div className="space-y-3">
          {bars.map(({ label, pct, value, color }) => (
            <div key={label} className="flex items-center gap-3">
              <span className="text-sm w-40 shrink-0">{label}</span>
              <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                <div className={`${color} h-full rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm font-medium tabular-nums w-10 text-right">{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
