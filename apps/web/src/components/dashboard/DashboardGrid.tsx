'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useMemo, useState } from 'react';

import { formatCalendarDate, greetingAt, isoWeekOf, type WidgetId } from '@luke/core';

import { useFormatDate } from '../../hooks/useFormatDate';
import { trpc } from '../../lib/trpc';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';

import { DashboardCustomizeSheet } from './DashboardCustomizeSheet';
import { WIDGET_REGISTRY } from './widgetRegistry';
import { ClocksWidget } from './widgets/ClocksWidget';
import { ForexWidget } from './widgets/ForexWidget';
import { KpiStatsWidget } from './widgets/KpiStatsWidget';
import { SeasonProgressWidget } from './widgets/SeasonProgressWidget';
import { TasksWidget } from './widgets/TasksWidget';
import { WeeklySalesWidget } from './widgets/WeeklySalesWidget';

/**
 * Greeting, today and its ISO week, all read in the profile zone. Until the zone is known (or when
 * it cannot be), a greeting that claims no time of day and a placeholder for the date.
 */
export function DashboardHeader({ firstName }: { firstName?: string }) {
  const { zone, today } = useFormatDate();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {zone ? greetingAt(new Date(), zone) : 'Ciao'}{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="text-sm text-muted-foreground mt-0.5 capitalize">
        {today
          ? `${formatCalendarDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Settimana ${isoWeekOf(today).week}`
          : '…'}
      </p>
    </div>
  );
}

/**
 * Responsive dashboard layout that renders enabled widgets based on the user's saved configuration.
 *
 * Loads widget config from `dashboard.getConfig`. Falls back to `WIDGET_REGISTRY.defaultEnabled`
 * when no saved preference exists. Opens `DashboardCustomizeSheet` for personalization.
 */
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
