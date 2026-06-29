'use client';

import { AlertTriangle, Clock } from 'lucide-react';

import { COLLECTION_PROGRESS } from '@luke/core';

import { Alert, AlertDescription } from '../../../../../components/ui/alert';
import { Badge } from '../../../../../components/ui/badge';
import { trpc } from '../../../../../lib/trpc';

interface CollectionRow {
  progress: string | null;
}

interface Props {
  brandId: string;
  seasonId: string;
  allRows: CollectionRow[];
}

function daysUntil(date: string | Date): number {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

const PROGRESS_INDEX = Object.fromEntries(COLLECTION_PROGRESS.map((p, i) => [p, i]));

function progressIndex(p: string | null): number {
  return p ? (PROGRESS_INDEX[p] ?? -1) : -1;
}

const PROGRESS_LABELS: Record<string, string> = {
  DESIGN:           'Fase di design',
  CONSTRUCTION_OK:  'Construction OK',
  MODELLERIA_OK:    'Modelleria OK',
  RENDERING:        'Rendering',
  SPECSHEETS_READY: 'Spec sheets ready',
  SMS_LAUNCHED:     'SMS lanciati',
};

/**
 * Warning banner that alerts users when upcoming calendar events require a
 * collection progress level that has not yet been reached by all rows.
 *
 * Queries `seasonCalendar.listEventsForCollection` and cross-references each
 * event's `requiredCollectionProgress` against the current row `progress`
 * values. Hidden when there are no upcoming deadline events.
 *
 * @param allRows - Current collection rows used to count progress laggards.
 */
export function CollectionDeadlineBanner({ brandId, seasonId, allRows }: Props) {
  const { data: events = [] } = trpc.seasonCalendar.listEventsForCollection.useQuery(
    { brandId, seasonId },
    { staleTime: 60_000 },
  );

  if (events.length === 0) return null;

  const alerts: { id: string; title: string; requiredProgress: string; daysLeft: number; behindCount: number }[] = [];

  for (const event of events) {
    if (!event.requiredCollectionProgress) continue;
    const days = daysUntil(event.startAt);
    const warningDays = event.progressWarningDays ?? 7;
    if (days < 0 || days > warningDays) continue;
    const reqIdx = progressIndex(event.requiredCollectionProgress);
    const behindCount = allRows.filter(r => progressIndex(r.progress) < reqIdx).length;
    alerts.push({ id: event.id, title: event.title, requiredProgress: event.requiredCollectionProgress, daysLeft: days, behindCount });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map(({ id, title, requiredProgress, daysLeft, behindCount }) => (
        <Alert key={id} variant={daysLeft <= 2 ? 'destructive' : 'default'} className="flex items-start gap-3">
          {daysLeft <= 2 ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> : <Clock className="h-4 w-4 shrink-0 mt-0.5" />}
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{title}</span>
            <Badge variant={daysLeft <= 2 ? 'destructive' : 'secondary'} className="text-xs">
              {daysLeft === 0 ? 'oggi' : daysLeft === 1 ? 'domani' : `fra ${daysLeft} giorni`}
            </Badge>
            {behindCount > 0 ? (
              <span className="text-sm">
                <span className="font-semibold">{behindCount} {behindCount === 1 ? 'riga' : 'righe'}</span>
                {' '}non {behindCount === 1 ? 'ha ancora raggiunto' : 'hanno ancora raggiunto'}{' '}
                <span className="font-medium">{PROGRESS_LABELS[requiredProgress] ?? requiredProgress}</span>
              </span>
            ) : (
              <span className="text-sm text-green-700 dark:text-green-400 font-medium">Tutte le righe sono in pari ✓</span>
            )}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
