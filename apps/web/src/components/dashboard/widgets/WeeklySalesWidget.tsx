'use client';

import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Skeleton } from '../../ui/skeleton';
import { trpc } from '../../../lib/trpc';
import { cn } from '../../../lib/utils';

export function WeeklySalesWidget() {
  const { data, isLoading } = trpc.dashboard.getWeeklySales.useQuery();

  const todayStr = new Date().toISOString().slice(0, 10);
  const maxCount = data && data.length > 0 ? Math.max(...data.map(d => d.count), 1) : 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Vendite settimanali</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-end gap-1 h-16">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${[60, 40, 80, 50, 70, 45, 65][i]}%` }} />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun dato disponibile per il contesto corrente.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end gap-1 h-16">
              {data.map(({ date, count }) => {
                const isToday = date === todayStr;
                const pct = Math.max(4, Math.round((count / maxCount) * 100));
                return (
                  <div key={date} className="flex-1 flex flex-col items-center gap-0.5 group">
                    <div
                      className={cn(
                        'w-full rounded-sm transition-all',
                        isToday ? 'bg-foreground' : 'bg-primary group-hover:bg-primary/80'
                      )}
                      style={{ height: `${pct}%` }}
                      title={`${count} ordini`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              {data.map(({ date, count }) => {
                const isToday = date === todayStr;
                return (
                  <div key={date} className="flex-1 text-center">
                    <div className={cn(isToday && 'font-medium text-foreground')}>
                      {isToday ? 'Oggi' : new Date(date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short' })}
                    </div>
                    <div className="font-medium text-foreground">{count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
