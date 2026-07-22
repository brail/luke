'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { DEFAULT_WARNING_LEAD_MINUTES } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Switch } from '../../../../components/ui/switch';
import { Textarea } from '../../../../components/ui/textarea';
import { usePermission } from '../../../../hooks/usePermission';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

const STATUS_LABEL: Record<'INACTIVE' | 'SCHEDULED' | 'ACTIVE', string> = {
  INACTIVE: 'Inattiva',
  SCHEDULED: 'Pianificata',
  ACTIVE: 'Attiva',
};

/** `datetime-local` needs a value with no timezone suffix and minute precision. */
function minDateTimeLocal(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000); // almeno 5 minuti nel futuro
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 16);
}

export default function MaintenanceModePage() {
  const { can } = usePermission();
  const canManage = can('maintenance:update');
  const utils = trpc.useUtils();

  const { data: state, isLoading } = trpc.maintenance.mode.getStatus.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [message, setMessage] = useState('');
  const [forceLogout, setForceLogout] = useState(false);
  const [notifyByEmail, setNotifyByEmail] = useState(false);
  const [confirmActivateOpen, setConfirmActivateOpen] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  const invalidate = () => void utils.maintenance.mode.getStatus.invalidate();

  const scheduleMutation = trpc.maintenance.mode.schedule.useMutation({
    onSuccess: () => {
      toast.success('Manutenzione pianificata');
      invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const activateMutation = trpc.maintenance.mode.activateNow.useMutation({
    onSuccess: () => {
      toast.success('Modalità manutenzione attivata');
      invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const cancelMutation = trpc.maintenance.mode.cancelScheduled.useMutation({
    onSuccess: () => {
      toast.success('Pianificazione annullata');
      invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const endMutation = trpc.maintenance.mode.end.useMutation({
    onSuccess: () => {
      toast.success('Modalità manutenzione terminata');
      invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleSchedule = () => {
    if (!scheduledAtLocal) {
      toast.error('Seleziona data e ora');
      return;
    }
    scheduleMutation.mutate({
      scheduledAt: new Date(scheduledAtLocal).toISOString(),
      message: message.trim() || undefined,
      forceLogout,
      warningLeadMinutes: DEFAULT_WARNING_LEAD_MINUTES,
      notifyByEmail,
    });
  };

  const isBusy = scheduleMutation.isPending || activateMutation.isPending || cancelMutation.isPending || endMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modalità manutenzione"
        description="Blocca l'accesso ai non-admin per un intervento programmato o immediato. Riusabile per qualunque manutenzione, non solo per i ripristini da backup."
      />

      <SectionCard title="Stato attuale">
        {isLoading || !state ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={state.status === 'ACTIVE' ? 'destructive' : state.status === 'SCHEDULED' ? 'outline' : 'secondary'}>
                {STATUS_LABEL[state.status]}
              </Badge>
              {state.status === 'SCHEDULED' && state.scheduledAt && (
                <span className="text-sm text-muted-foreground">
                  Prevista per {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.scheduledAt))}
                </span>
              )}
              {state.status === 'ACTIVE' && state.activatedAt && (
                <span className="text-sm text-muted-foreground">
                  Attiva dalle {new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.activatedAt))}
                </span>
              )}
            </div>
            {state.message && <p className="text-sm">{state.message}</p>}

            {state.status === 'SCHEDULED' && (
              <Button
                variant="outline"
                onClick={() => cancelMutation.mutate()}
                disabled={!canManage || isBusy}
              >
                Annulla pianificazione
              </Button>
            )}
            {state.status === 'ACTIVE' && (
              <Button
                variant="destructive"
                onClick={() => setConfirmEndOpen(true)}
                disabled={!canManage || isBusy}
              >
                Termina manutenzione
              </Button>
            )}
          </div>
        )}
      </SectionCard>

      {state?.status === 'INACTIVE' && (
        <SectionCard
          title="Pianifica manutenzione"
          description="Gli utenti non-admin ricevono avvisi a 15, 5 e 1 minuto dall'inizio, poi vengono bloccati automaticamente."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduledAt">Data e ora di inizio</Label>
              <Input
                id="scheduledAt"
                type="datetime-local"
                min={minDateTimeLocal()}
                value={scheduledAtLocal}
                onChange={e => setScheduledAtLocal(e.target.value)}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Motivo della manutenzione (opzionale)</Label>
              <Textarea
                id="message"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Es. Aggiornamento del sistema in corso, tornerà disponibile a breve."
                disabled={!canManage}
              />
              <p className="text-sm text-muted-foreground">
                Mostrato nel banner, nelle notifiche e nell&apos;eventuale email agli utenti.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="forceLogout">Forza il logout di tutti i non-admin</Label>
                <p className="text-sm text-muted-foreground">
                  Se attivo, all&apos;avvio della manutenzione le sessioni non-admin vengono invalidate subito invece di restare semplicemente bloccate.
                </p>
              </div>
              <Switch id="forceLogout" checked={forceLogout} onCheckedChange={setForceLogout} disabled={!canManage} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5 pr-4">
                <Label htmlFor="notifyByEmail">Avvisa tutti gli utenti via email</Label>
                <p className="text-sm text-muted-foreground">
                  Invia subito un&apos;email a tutti gli utenti con data e motivo, e un&apos;altra quando la manutenzione si conclude.
                </p>
              </div>
              <Switch id="notifyByEmail" checked={notifyByEmail} onCheckedChange={setNotifyByEmail} disabled={!canManage} />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmActivateOpen(true)}
                disabled={!canManage || isBusy}
              >
                Attiva subito
              </Button>
              <Button onClick={handleSchedule} disabled={!canManage || isBusy}>
                {scheduleMutation.isPending ? 'Pianificazione...' : 'Pianifica'}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmActivateOpen}
        onOpenChange={setConfirmActivateOpen}
        title="Attiva subito la manutenzione"
        description="Tutti gli utenti non-admin verranno immediatamente bloccati dall'app. Confermi?"
        actionType="warning"
        confirmText="Attiva subito"
        isLoading={activateMutation.isPending}
        onConfirm={() => activateMutation.mutate({ message: message.trim() || undefined, forceLogout })}
      />

      <ConfirmDialog
        open={confirmEndOpen}
        onOpenChange={setConfirmEndOpen}
        title="Termina la manutenzione"
        description="L'app torna accessibile a tutti gli utenti. Confermi che l'intervento è concluso?"
        actionType="warning"
        confirmText="Termina"
        isLoading={endMutation.isPending}
        onConfirm={() => endMutation.mutate()}
      />
    </div>
  );
}
