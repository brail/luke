'use client';

import { toast } from 'sonner';

import { trpc } from '../../../../lib/trpc';
import { Switch } from '../../../../components/ui/switch';
import { Skeleton } from '../../../../components/ui/skeleton';

const CATEGORY_META: Record<string, { label: string; description: string }> = {
  SYSTEM: {
    label: 'Sistema',
    description: 'Sincronizzazioni NAV, errori e job di sistema',
  },
  CALENDAR: {
    label: 'Calendario',
    description: 'Milestone in scadenza, kickoff e deadline del calendario stagione',
  },
  USER_ACTION: {
    label: 'Azioni utente',
    description: 'Menzioni, task assegnati e interazioni da altri utenti',
  },
  WORKFLOW: {
    label: 'Workflow',
    description: 'Approvazioni, cambio stato entità e richieste di accesso',
  },
};

export function NotificationPreferences() {
  const { data: prefs, isLoading } = trpc.notifications.preferences.list.useQuery();
  const utils = trpc.useUtils();

  const updateMutation = trpc.notifications.preferences.update.useMutation({
    onSuccess: () => {
      void utils.notifications.preferences.list.invalidate();
    },
    onError: () => {
      toast.error('Errore nel salvataggio delle preferenze');
      void utils.notifications.preferences.list.invalidate();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(prefs ?? []).map(pref => {
        const meta = CATEGORY_META[pref.category];
        return (
          <div
            key={pref.category}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{meta?.label ?? pref.category}</p>
              <p className="text-xs text-muted-foreground">{meta?.description}</p>
            </div>
            <Switch
              checked={pref.enabled}
              disabled={updateMutation.isPending}
              onCheckedChange={enabled => {
                updateMutation.mutate({ category: pref.category as any, enabled });
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
