'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_CHANGE_KEYS, CALENDAR_DEADLINE_KEYS, CALENDAR_DIGEST_KEY, type CalendarEventKey } from '@luke/core';

import { PermissionButton } from '../../../../components/PermissionButton';
import { Button } from '../../../../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../../components/ui/collapsible';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Switch } from '../../../../components/ui/switch';
import { usePermission } from '../../../../hooks/usePermission';
import { NOTIFICATION_CATEGORY_META } from '../../../../lib/notificationCategoryMeta';
import { trpc } from '../../../../lib/trpc';
import { cn } from '../../../../lib/utils';

import { SendDigestDialog } from './SendDigestDialog';

const CALENDAR_EVENT_LABELS: Record<CalendarEventKey, string> = {
  CALENDAR_CREATE: 'Nuovo evento creato',
  CALENDAR_UPDATE: 'Evento modificato',
  CALENDAR_RESCHEDULE: 'Evento spostato',
  CALENDAR_DELETE: 'Evento eliminato',
  CALENDAR_BULK_DELETE: 'Eliminazione multipla',
  CALENDAR_CANCEL: 'Evento annullato',
  CALENDAR_UNCANCEL: 'Evento ripristinato',
  CALENDAR_APPLY_TEMPLATE: 'Template applicato',
  CALENDAR_CLONE: 'Calendario clonato',
  CALENDAR_DEADLINE_UPCOMING: 'Evento in scadenza',
  CALENDAR_DEADLINE_OVERDUE: 'Evento scaduto',
  CALENDAR_PHASE_OVERDUE: 'Righe in ritardo su una fase',
  CALENDAR_DIGEST: 'Recap email giornaliero',
};

/** The switches of the "Personalizza" section, by kind; the digest has its own switch above it. */
const CALENDAR_OVERRIDE_GROUPS: { label: string; keys: readonly CalendarEventKey[] }[] = [
  { label: 'Modifiche', keys: CALENDAR_CHANGE_KEYS },
  { label: 'Scadenze', keys: CALENDAR_DEADLINE_KEYS },
];

/**
 * The CALENDAR event-key switches under the category toggle, each showing the state senders apply
 * (`listCalendarEventOverrides`): the digest's own switch — muting a kind of change or deadline
 * leaves the email alone — and an expandable "Personalizza" section with the others. The category is
 * the master switch: with it off, every kind is off and its switch is disabled.
 */
function CalendarEventSwitches({ categoryEnabled }: { categoryEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: overrides, isError } = trpc.notifications.preferences.listCalendarEventOverrides.useQuery();
  const updateMutation = trpc.notifications.preferences.updateCalendarEventOverride.useMutation({
    onSuccess: () => {
      void utils.notifications.preferences.listCalendarEventOverrides.invalidate();
    },
    onError: () => {
      toast.error('Errore nel salvataggio delle preferenze');
      void utils.notifications.preferences.listCalendarEventOverrides.invalidate();
    },
  });

  if (isError) return <p className="mt-3 text-xs text-destructive">Impossibile caricare le preferenze del calendario.</p>;
  if (!overrides) return <Skeleton className="mt-3 h-10 w-full" />;

  const keySwitch = (eventKey: CalendarEventKey) => (
    <Switch
      checked={overrides.find(o => o.eventKey === eventKey)?.enabled ?? false}
      disabled={!categoryEnabled || updateMutation.isPending}
      onCheckedChange={checked => updateMutation.mutate({ eventKey, enabled: checked })}
      aria-label={CALENDAR_EVENT_LABELS[eventKey]}
    />
  );

  return (
    <>
      <div className="mt-3 flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm">{CALENDAR_EVENT_LABELS[CALENDAR_DIGEST_KEY]}</p>
          <p className="text-xs text-muted-foreground">Un&apos;email al giorno con le modifiche ai calendari che vedi</p>
        </div>
        {keySwitch(CALENDAR_DIGEST_KEY)}
      </div>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-muted-foreground">
            <ChevronDown className={cn('h-3 w-3 mr-1 transition-transform', open && 'rotate-180')} />
            Personalizza notifiche calendario
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-3">
          {CALENDAR_OVERRIDE_GROUPS.map(group => (
            <div key={group.label} className="space-y-2">
              <p className="pl-4 text-xs font-medium">{group.label}</p>
              {group.keys.map(eventKey => (
                <div key={eventKey} className="flex items-center justify-between pl-4">
                  <p className="text-xs text-muted-foreground">{CALENDAR_EVENT_LABELS[eventKey]}</p>
                  {keySwitch(eventKey)}
                </div>
              ))}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

/**
 * List of per-category notification toggles that persists preferences via `trpc.notifications.preferences.update`.
 * Shows skeleton placeholders while the preferences query is loading.
 */
export function NotificationPreferences() {
  const { data: prefs, isLoading } = trpc.notifications.preferences.list.useQuery();
  const utils = trpc.useUtils();
  const { can } = usePermission();
  const [digestDialogOpen, setDigestDialogOpen] = useState(false);

  const updateMutation = trpc.notifications.preferences.update.useMutation({
    onSuccess: () => {
      void utils.notifications.preferences.list.invalidate();
      // A key without its own switch follows the category.
      void utils.notifications.preferences.listCalendarEventOverrides.invalidate();
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
        const meta = NOTIFICATION_CATEGORY_META[pref.category];
        return (
          <div key={pref.category} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{meta?.label ?? pref.category}</p>
                <p className="text-xs text-muted-foreground">{meta?.description}</p>
              </div>
              <div className="flex items-center gap-3">
                {pref.category === 'CALENDAR' && (
                  <PermissionButton
                    hasPermission={can('season_calendar:read')}
                    tooltip="Non hai il permesso di inviare il recap del calendario"
                    variant="outline"
                    size="sm"
                    onClick={() => setDigestDialogOpen(true)}
                  >
                    Invia Recap
                  </PermissionButton>
                )}
                <Switch
                  checked={pref.enabled}
                  disabled={updateMutation.isPending}
                  onCheckedChange={enabled => {
                    updateMutation.mutate({ category: pref.category, enabled });
                  }}
                />
              </div>
            </div>
            {pref.category === 'CALENDAR' && <CalendarEventSwitches categoryEnabled={pref.enabled} />}
          </div>
        );
      })}
      <SendDigestDialog open={digestDialogOpen} onClose={() => setDigestDialogOpen(false)} />
    </div>
  );
}
