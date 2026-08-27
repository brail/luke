'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Label } from '../../../../components/ui/label';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

interface Props {
  eventId: string;
  readOnly?: boolean;
}

function displayName(u: { firstName: string; lastName: string; username: string }) {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return full || u.username;
}

/**
 * "Condivisa con" section of the event dialog — grants or revokes
 * `CalendarEventUserVisibility` for individual users outside the event's visible functions.
 * The candidate pool (`listGrantCandidates`) is already scoped to users with access to the
 * event's brand, so nobody offered here can be rejected on save (see `grantUserVisibility`'s
 * own brand-access validation).
 */
export function CalendarEventShareSection({ eventId, readOnly = false }: Props) {
  const utils = trpc.useUtils();
  const { data: candidates, isLoading } = trpc.seasonCalendar.listGrantCandidates.useQuery({ eventId });

  const [localGrantedIds, setLocalGrantedIds] = useState<string[]>([]);

  useEffect(() => {
    if (candidates) setLocalGrantedIds(candidates.filter(c => c.alreadyGranted).map(c => c.id));
  }, [candidates]);

  const grantMutation = trpc.seasonCalendar.grantUserVisibility.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const revokeMutation = trpc.seasonCalendar.revokeUserVisibility.useMutation({
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });
  const isPending = grantMutation.isPending || revokeMutation.isPending;

  const originalIds = (candidates ?? []).filter(c => c.alreadyGranted).map(c => c.id);
  const hasChanges = originalIds.length !== localGrantedIds.length
    || originalIds.some(id => !localGrantedIds.includes(id));

  const handleSave = async () => {
    const toAdd = localGrantedIds.filter(id => !originalIds.includes(id));
    const toRemove = originalIds.filter(id => !localGrantedIds.includes(id));
    try {
      const ops: Promise<unknown>[] = [];
      if (toAdd.length > 0) ops.push(grantMutation.mutateAsync({ eventId, userIds: toAdd }));
      if (toRemove.length > 0) ops.push(revokeMutation.mutateAsync({ eventId, userIds: toRemove }));
      await Promise.all(ops);
      toast.success('Condivisione aggiornata');
      await utils.seasonCalendar.listGrantCandidates.invalidate({ eventId });
    } catch {
      // errors already toasted
    }
  };

  const toggle = (id: string) =>
    setLocalGrantedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  if (isLoading) return null;

  return (
    <div className="space-y-1.5">
      <Label>Condivisa con</Label>
      <p className="text-xs text-muted-foreground">
        Dà accesso a una persona specifica anche se non appartiene a nessuna delle funzioni sopra — solo tra chi ha già accesso a questo brand.
      </p>
      {(candidates ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessun utente con accesso a questo brand da poter aggiungere.</p>
      ) : (
        <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
          {(candidates ?? []).map(u => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-muted/40">
              <Checkbox
                checked={localGrantedIds.includes(u.id)}
                onCheckedChange={() => toggle(u.id)}
                disabled={readOnly}
              />
              <span className="flex-1 truncate">{displayName(u)}</span>
              <span className="text-xs text-muted-foreground">{u.username}</span>
            </label>
          ))}
        </div>
      )}
      {!readOnly && hasChanges && (
        <Button type="button" size="sm" variant="outline" onClick={() => void handleSave()} disabled={isPending}>
          {isPending ? 'Salvataggio…' : 'Salva condivisioni'}
        </Button>
      )}
    </div>
  );
}
