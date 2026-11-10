'use client';

import type { RouterOutputs } from '@luke/api';

import { SectionCard } from '../../../../components/SectionCard';
import { useFormatDate } from '../../../../hooks/useFormatDate';
import { cn } from '../../../../lib/utils';

type SyncStatus = RouterOutputs['integrations']['google']['getSyncStatus'][number];

const OPERATION_LABELS: Record<SyncStatus['operation'], string> = {
  events: 'Sincronizzazione eventi',
  readers: 'Lettori dei calendari',
  delete: 'Eliminazioni',
};

/** The error is red until a later success of the same operation, which mutes it without clearing it. */
const errorIsLatest = (op: SyncStatus) =>
  !op.lastSuccessAt || (!!op.lastErrorAt && new Date(op.lastErrorAt) >= new Date(op.lastSuccessAt));

/**
 * The last outcome of each Google Calendar operation that has one (#223): both times and the last
 * error in full, never a verdict — a later success of one event does not clear another event's
 * failure. Nothing until an operation has an outcome.
 */
export function GoogleSyncStatus({ operations }: { operations: SyncStatus[] }) {
  const fmt = useFormatDate();
  if (operations.length === 0) return null;

  return (
    <SectionCard title="Stato sincronizzazione" description="Ultimo esito di ogni operazione di Google Calendar.">
      <dl className="space-y-4">
        {operations.map(op => (
          <div key={op.operation} className="space-y-1 text-sm">
            <dt className="font-medium">{OPERATION_LABELS[op.operation]}</dt>
            <dd className="text-muted-foreground">
              Ultimo successo: {op.lastSuccessAt ? fmt.dateTime(op.lastSuccessAt) : '—'}
            </dd>
            <dd className="text-muted-foreground">
              Ultimo errore: {op.lastErrorAt ? fmt.dateTime(op.lastErrorAt) : '—'}
            </dd>
            {op.lastError && (
              <dd className={cn('break-words', errorIsLatest(op) ? 'text-status-critical' : 'text-muted-foreground')}>
                {op.lastError}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
