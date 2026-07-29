'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CALENDAR_EVENT_KEYS, type CalendarEventKey } from '@luke/core';

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
};

/**
 * Expandable "Personalizza notifiche calendario" section — per-event overrides on top of
 * the coarser CALENDAR category toggle above. Only fetches when expanded.
 */
function CalendarEventOverrides() {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: overrides, isLoading } = trpc.notifications.preferences.listCalendarEventOverrides.useQuery(
    undefined,
    { enabled: open }
  );
  const updateMutation = trpc.notifications.preferences.updateCalendarEventOverride.useMutation({
    onSuccess: () => {
      void utils.notifications.preferences.listCalendarEventOverrides.invalidate();
    },
    onError: () => {
      toast.error('Errore nel salvataggio delle preferenze');
      void utils.notifications.preferences.listCalendarEventOverrides.invalidate();
    },
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-muted-foreground">
          <ChevronDown className={cn('h-3 w-3 mr-1 transition-transform', open && 'rotate-180')} />
          Personalizza notifiche calendario
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-3">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          CALENDAR_EVENT_KEYS.map(eventKey => {
            const enabled = overrides?.find(o => o.eventKey === eventKey)?.enabled ?? true;
            return (
              <div key={eventKey} className="flex items-center justify-between pl-4">
                <p className="text-xs text-muted-foreground">{CALENDAR_EVENT_LABELS[eventKey]}</p>
                <Switch
                  checked={enabled}
                  disabled={updateMutation.isPending}
                  onCheckedChange={checked => updateMutation.mutate({ eventKey, enabled: checked })}
                />
              </div>
            );
          })
        )}
      </CollapsibleContent>
    </Collapsible>
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
                {pref.category === 'CALENDAR' && can('config:update') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDigestDialogOpen(true)}
                  >
                    Invia Recap
                  </Button>
                )}
                <Switch
                  checked={pref.enabled}
                  disabled={updateMutation.isPending}
                  onCheckedChange={enabled => {
                    updateMutation.mutate({ category: pref.category as any, enabled });
                  }}
                />
              </div>
            </div>
            {pref.category === 'CALENDAR' && <CalendarEventOverrides />}
          </div>
        );
      })}
      <SendDigestDialog open={digestDialogOpen} onClose={() => setDigestDialogOpen(false)} />
    </div>
  );
}
