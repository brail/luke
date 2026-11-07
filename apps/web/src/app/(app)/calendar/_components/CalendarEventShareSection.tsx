'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Label } from '../../../../components/ui/label';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

import { useHideFromSaverPrompt } from './useHideFromSaverPrompt';

interface Props {
  eventId: string;
  readOnly?: boolean;
  /** After the user revoked their own last way to the event: they can no longer see it. */
  onLostAccess?: () => void;
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
 * own brand-access validation), and leaves out who already sees the event as saved, unless
 * already granted.
 */
export function CalendarEventShareSection({ eventId, readOnly = false, onLostAccess }: Props) {
  const utils = trpc.useUtils();
  const { data: candidates, isLoading, error } = trpc.seasonCalendar.listGrantCandidates.useQuery({ eventId });

  const [localGrantedIds, setLocalGrantedIds] = useState<string[]>([]);

  useEffect(() => {
    if (candidates) setLocalGrantedIds(candidates.filter(c => c.alreadyGranted).map(c => c.id));
  }, [candidates]);

  // Their errors are handled where they are called: refusing one's own last grant asks instead (#199).
  const grantMutation = trpc.seasonCalendar.grantUserVisibility.useMutation();
  const revokeMutation = trpc.seasonCalendar.revokeUserVisibility.useMutation();
  const hideFromSaver = useHideFromSaverPrompt('Revoca comunque');
  const isPending = grantMutation.isPending || revokeMutation.isPending;

  const originalIds = (candidates ?? []).filter(c => c.alreadyGranted).map(c => c.id);
  const hasChanges = originalIds.length !== localGrantedIds.length
    || originalIds.some(id => !localGrantedIds.includes(id));

  const refresh = () => Promise.all([
    utils.seasonCalendar.listGrantCandidates.invalidate({ eventId }),
    utils.seasonCalendar.listMilestones.invalidate(),
  ]);

  const handleSave = async () => {
    const toAdd = localGrantedIds.filter(id => !originalIds.includes(id));
    const toRemove = originalIds.filter(id => !localGrantedIds.includes(id));
    try {
      // The grant first: a user who sees the event only through a grant may be revoking their own,
      // and from then on cannot reach the event.
      if (toAdd.length > 0) await grantMutation.mutateAsync({ eventId, userIds: toAdd });
      if (toRemove.length > 0) await revokeMutation.mutateAsync({ eventId, userIds: toRemove });
    } catch (err) {
      if (!hideFromSaver.ask(err, () => void revokeConfirmed(toRemove))) toast.error(getTrpcErrorMessage(err));
      // Grants may have landed before the revoke failed: show what is saved.
      if (toAdd.length > 0) await refresh();
      return;
    }
    toast.success('Condivisione aggiornata');
    await refresh();
  };

  /** The revoke the user confirmed after being told the event leaves their calendar. */
  const revokeConfirmed = async (userIds: string[]) => {
    try {
      await revokeMutation.mutateAsync({ eventId, userIds, confirmHidesFromCaller: true });
    } catch (err) {
      toast.error(getTrpcErrorMessage(err));
      return;
    }
    toast.success('Condivisione aggiornata');
    // The event is gone for this user: its share list can no longer be read, the calendar can.
    await utils.seasonCalendar.listMilestones.invalidate();
    onLostAccess?.();
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
      {error ? (
        <p className="text-xs text-destructive">{getTrpcErrorMessage(error)}</p>
      ) : (candidates ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">Nessuno da aggiungere: chi ha accesso a questo brand vede già l&apos;evento.</p>
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
      {hideFromSaver.prompt}
    </div>
  );
}
