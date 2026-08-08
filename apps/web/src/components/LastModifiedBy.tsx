'use client';

import { getAuditActionLabel, type AuditLogLastChangeTargetType } from '@luke/core';

import { useFormatDate } from '../hooks/useFormatDate';
import { trpc } from '../lib/trpc';
import { cn } from '../lib/utils';

interface LastModifiedByProps {
  targetType: AuditLogLastChangeTargetType;
  targetId: string | null | undefined;
  className?: string;
}

/**
 * Shows who last touched an entity and when, derived from the audit trail
 * (`auditLog.getLastChange`). Renders nothing while loading, on a missing `targetId`,
 * or if the lookup errors (e.g. permission denial) — this is a secondary detail on an
 * entity view, not something that should surface its own error state.
 */
export function LastModifiedBy({ targetType, targetId, className }: LastModifiedByProps) {
  const fmt = useFormatDate();
  const { data, isLoading, isError } = trpc.auditLog.getLastChange.useQuery(
    { targetType, targetId: targetId ?? '' },
    { enabled: !!targetId, retry: false, staleTime: 60 * 1000 }
  );

  if (!targetId || isLoading || isError) return null;

  const baseClassName = cn('text-xs text-muted-foreground', className);

  if (!data) {
    return <p className={baseClassName}>Nessuna modifica registrata</p>;
  }

  return (
    <p className={baseClassName}>
      {getAuditActionLabel(data.action)} — {data.actorName ?? 'Utente sconosciuto'} il {fmt.dateTime(data.createdAt)}
    </p>
  );
}
