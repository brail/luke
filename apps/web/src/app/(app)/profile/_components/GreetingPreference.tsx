'use client';

import { toast } from 'sonner';

import { Switch } from '../../../../components/ui/switch';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';

interface GreetingPreferenceProps {
  /** Current value of the daily greeting kill-switch, from the already-loaded `me.get` query. */
  enabled: boolean;
}

/**
 * Toggle for the daily greeting modal kill-switch (`dailyGreetingEnabled` on `UserPreference`).
 * Reversible in one click, no confirmation needed.
 */
export function GreetingPreference({ enabled }: GreetingPreferenceProps) {
  const refresh = useRefresh();

  const updateMutation = trpc.me.updateGreetingPreference.useMutation({
    onSuccess: () => {
      void refresh.me();
    },
    onError: () => {
      toast.error('Errore nel salvataggio della preferenza');
      void refresh.me();
    },
  });

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Saluto giornaliero</p>
        <p className="text-xs text-muted-foreground">
          Un aforisma o una curiosità ad ogni primo accesso del giorno
        </p>
      </div>
      <Switch
        checked={enabled}
        disabled={updateMutation.isPending}
        onCheckedChange={value => {
          updateMutation.mutate({ enabled: value });
        }}
      />
    </div>
  );
}
