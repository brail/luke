'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { APP_CONFIG_DEFAULTS } from '@luke/core';

import { SectionCard } from '../../../../../components/SectionCard';
import { SettingsActions } from '../../../../../components/settings/SettingsActions';
import { Label } from '../../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { usePermission } from '../../../../../hooks/usePermission';
import { TIMEZONES } from '../../../../../lib/i18n/timezones';
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

  const { data } = trpc.config.getMultiple.useQuery({ keys: [KEY] }, { enabled: canRead });
  // An absent row means the registry default, which is also what the server reads.
  const stored = data?.[0]?.value ?? APP_CONFIG_DEFAULTS[KEY];
  // Only the unsaved choice is local state; otherwise the select shows what the server holds.
  const [draft, setDraft] = useState<string | null>(null);
  const timeZone = draft ?? stored;

  const saveMutation = trpc.config.set.useMutation({
    onSuccess: () => {
      toast.success('Fuso orario aziendale salvato');
      setDraft(null);
      void utils.config.getMultiple.invalidate();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  if (!canRead) return null;

  // A zone written elsewhere (the raw configuration page) stays visible even when it is not listed.
  const options = TIMEZONES.some(t => t.value === stored) ? TIMEZONES : [{ value: stored, label: stored }, ...TIMEZONES];

  return (
    <SectionCard
      title="Fuso orario aziendale"
      description="Il giorno in cui si contano scadenze, blocchi post-freeze e conteggi alla scadenza, e il fuso dell'ora del backup pianificato"
    >
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="business-time-zone">Fuso orario</Label>
        <Select value={timeZone} onValueChange={setDraft} disabled={!canUpdate}>
          <SelectTrigger id="business-time-zone"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
    </SectionCard>
  );
}
