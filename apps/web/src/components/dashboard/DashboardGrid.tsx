'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useSession } from 'next-auth/react';

import type { WidgetId } from '@luke/core';

import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { trpc } from '../../lib/trpc';
import { KpiStatsWidget } from './widgets/KpiStatsWidget';
import { SeasonProgressWidget } from './widgets/SeasonProgressWidget';
import { ClocksWidget } from './widgets/ClocksWidget';
import { ForexWidget } from './widgets/ForexWidget';
import { WeeklySalesWidget } from './widgets/WeeklySalesWidget';
import { TasksWidget } from './widgets/TasksWidget';
import { DashboardCustomizeSheet } from './DashboardCustomizeSheet';
import { WIDGET_REGISTRY } from './widgetRegistry';

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function DashboardHeader({ firstName }: { firstName?: string }) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const dateLabel = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {greeting}{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="text-sm text-muted-foreground mt-0.5 capitalize">
        {dateLabel} · Settimana {getISOWeek(now)}
      </p>
    </div>
  );
}

export function DashboardGrid() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data: session } = useSession();
  const { data: config, isLoading } = trpc.dashboard.getConfig.useQuery();

  const widgetMap = useMemo(
    () => new Map(config?.widgets.map(w => [w.id, w]) ?? []),
    [config]
  );

  function isEnabled(id: WidgetId): boolean {
    const saved = widgetMap.get(id);
    if (saved) return saved.enabled;
    return WIDGET_REGISTRY.find(d => d.id === id)?.defaultEnabled ?? true;
  }

  function getSettings(id: WidgetId): Record<string, unknown> | undefined {
    return widgetMap.get(id)?.settings;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <DashboardHeader firstName={session?.user?.firstName ?? undefined} />
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setSheetOpen(true)}
          title="Personalizza dashboard"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Skeleton className="md:col-span-2 h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {isEnabled('kpi-stats') && <KpiStatsWidget />}

          {(isEnabled('season-progress') || isEnabled('clocks') || isEnabled('forex')) && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {isEnabled('season-progress') && (
                <div className="md:col-span-2">
                  <SeasonProgressWidget />
                </div>
              )}
              {isEnabled('clocks') && <ClocksWidget settings={getSettings('clocks')} />}
              {isEnabled('forex') && <ForexWidget settings={getSettings('forex')} />}
            </div>
          )}

          {(isEnabled('tasks') || isEnabled('weekly-sales')) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {isEnabled('tasks') && <TasksWidget />}
              {isEnabled('weekly-sales') && <WeeklySalesWidget />}
            </div>
          )}
        </div>
      )}

      {config && (
        <DashboardCustomizeSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          widgets={config.widgets}
        />
      )}
    </div>
  );
}
