'use client';

import { DEFAULT_FOREX_PAIRS, type ForexSettings } from '@luke/core';

import { trpc } from '../../../lib/trpc';
import { cn } from '../../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';

const FIFTEEN_MIN = 15 * 60 * 1000;

export function ForexWidget({ settings }: { settings?: Record<string, unknown> }) {
  const pairs = (settings as ForexSettings | undefined)?.pairs ?? [...DEFAULT_FOREX_PAIRS];

  const { data, isLoading, dataUpdatedAt } = trpc.dashboard.getForexRates.useQuery(
    { pairs },
    { staleTime: FIFTEEN_MIN, refetchInterval: FIFTEEN_MIN }
  );

  const updatedLabel = dataUpdatedAt
    ? new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(new Date(dataUpdatedAt))
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Cambi valuta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {pairs.map(p => <Skeleton key={p} className="h-8 w-full" />)}
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {pairs.map(pair => {
                const [base, quote] = pair.split('/');
                const rate = data?.rates[pair];
                const prev = data?.previousRates[pair];
                const pctChange = rate !== undefined && prev !== undefined && prev !== 0
                  ? ((rate - prev) / prev) * 100
                  : null;

                return (
                  <div key={pair} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground font-mono">
                      {base} / {quote}
                    </span>
                    <div className="text-right">
                      <div className="text-xl font-bold tabular-nums leading-none">
                        {rate !== undefined ? rate.toFixed(3) : '—'}
                      </div>
                      {pctChange !== null && (
                        <div className={cn(
                          'text-xs tabular-nums mt-0.5',
                          pctChange > 0 ? 'text-green-600 dark:text-green-400' :
                          pctChange < 0 ? 'text-red-600 dark:text-red-400' :
                          'text-muted-foreground'
                        )}>
                          {pctChange > 0 ? '+' : ''}{pctChange.toFixed(2)}%
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {updatedLabel && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                Aggiornato alle {updatedLabel}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
