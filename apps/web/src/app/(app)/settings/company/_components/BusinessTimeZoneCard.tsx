'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { APP_CONFIG_DEFAULTS } from '@luke/core';

import { SectionCard } from '../../../../../components/SectionCard';
import { SettingsActions } from '../../../../../components/settings/SettingsActions';
import { SettingsFormGate } from '../../../../../components/settings/SettingsFormShell';
import { TimeZoneSelect } from '../../../../../components/TimeZoneSelect';
import { Label } from '../../../../../components/ui/label';
import { usePermission } from '../../../../../hooks/usePermission';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

const KEY = 'app.defaultTimezone';

/**
 * The business time zone (`app.defaultTimezone`): the day shared deadlines, post-freeze locks and
 * countdowns are counted in, the zone of the scheduled backup hour, and the zone a user reads in when
 * their stored `User.timezone` is not an IANA name. Read with `config:read` and saved through
 * `config.set` (`config:update`, audited, validated against the registry) — no dedicated procedure.
 */
export function BusinessTimeZoneCard() {
  const { can } = usePermission();
  const canRead = can('config:read');
  const canUpdate = can('config:update');
  const utils = trpc.useUtils();

  const { data, isPending, error, refetch } = trpc.config.getMultiple.useQuery({ keys: [KEY] }, { enabled: canRead });
  // An absent row means the registry default, which is also what the server reads. A zone stored
  // encrypted cannot be shown: nothing is selected until one is chosen, never the default.
  const encrypted = !!data?.[0]?.isEncrypted;
  const stored = encrypted ? '' : (data?.[0]?.value ?? APP_CONFIG_DEFAULTS[KEY]);
  // Only the unsaved choice is local state; otherwise the select shows what the server holds.
  const [draft, setDraft] = useState<string | null>(null);
  const timeZone = draft ?? stored;

  const saveMutation = trpc.config.set.useMutation({
    onSuccess: async () => {
      toast.success('Fuso orario aziendale salvato');
      // Drop the draft once the saved zone is read back, or the select flashes the previous one.
      await utils.config.getMultiple.invalidate({ keys: [KEY] });
      setDraft(null);
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  if (!canRead) return null;

  return (
    <SectionCard
      title="Fuso orario aziendale"
      description="Il giorno in cui si contano scadenze, blocchi post-freeze e conteggi alla scadenza, e il fuso dell'ora del backup pianificato"
    >
      {/* Without the stored zone the select would show the default as if it were saved. */}
      <SettingsFormGate isPending={isPending} error={error} hasData={!!data} onRetry={() => void refetch()}>
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="business-time-zone">Fuso orario</Label>
          <TimeZoneSelect id="business-time-zone" value={timeZone} onValueChange={setDraft} stored={stored} disabled={!canUpdate} />
          {encrypted && draft === null && (
            <p className="text-sm text-muted-foreground">Il fuso salvato è cifrato e qui non si vede: scegline uno per sostituirlo, in chiaro.</p>
          )}
          <p className="text-sm text-muted-foreground">
            Cambiarlo ricalcola subito conteggi, fasce e blocchi, anche di eventi passati. Revisioni,
            notifiche e riepiloghi già inviati restano come sono.
          </p>
        </div>
        <SettingsActions
          onSave={() => saveMutation.mutate({ key: KEY, value: timeZone })}
          isSaving={saveMutation.isPending}
          disabled={!canUpdate || timeZone === stored}
        />
      </SettingsFormGate>
    </SectionCard>
  );
}
