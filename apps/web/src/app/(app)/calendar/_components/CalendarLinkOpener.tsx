'use client';

import { Info } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { eventCalendarDays, type CalendarDate, type CalendarLinkTarget } from '@luke/core';

import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { useContextMutation } from '../../../../contexts/useContextMutation';
import { useFormatDate } from '../../../../hooks/useFormatDate';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

const EVENT_GONE = 'Evento non più disponibile';

interface CalendarLinkOpenerProps {
  target: CalendarLinkTarget | null;
  /** The user's context, which the page shows: a link opens directly only there. */
  brandId: string;
  seasonId: string;
  selectedBrandIds: string[];
  /** The page's events, not narrowed by the function chips; `undefined` while loading. */
  events: { id: string }[] | undefined;
  isFetching: boolean;
  refetch: () => unknown;
  /** Adds a brand to the page's selection: the context's own may have been deselected. */
  onSelectBrand: (brandId: string) => void;
  onOpenEvent: (eventId: string) => void;
  /** Drops the target from the URL, moving the view to `date` when given. */
  onDone: (date?: CalendarDate) => void;
}

/**
 * Opens what a notification link points at (`?event=`, `?calendar=`, resolved by
 * `seasonCalendar.locate`). In its own context an event opens on its day and a calendar is simply
 * shown; in another one a banner offers to switch — an explicit choice, since it changes the user's
 * saved context — or to ignore it. A target that is gone, or hidden from the user, says so. Once
 * handled the target leaves the URL, so another link, or the same one again, is handled anew.
 */
export function CalendarLinkOpener({
  target, brandId, seasonId, selectedBrandIds, events, isFetching, refetch, onSelectBrand, onOpenEvent, onDone,
}: CalendarLinkOpenerProps) {
  const { zone } = useFormatDate();
  const { setContext, isPending } = useContextMutation();
  const located = trpc.seasonCalendar.locate.useQuery(target ?? { calendarId: '' }, {
    enabled: !!target,
    retry: false,
    // Read fresh each time a link is followed: a cached answer may name the event's old day.
    staleTime: 0,
  });
  const key = target && ('eventId' in target ? `event:${target.eventId}` : `calendar:${target.calendarId}`);
  /** The target the list was fetched again for, once, when its event was not in it yet. */
  const refetchedFor = useRef<string | null>(null);

  const found = key ? located.data : undefined;
  const inContext = !!found && found.brandId === brandId && found.seasonId === seasonId;

  useEffect(() => {
    if (!key || !located.error) return;
    // Dropped whatever the error: a malformed link would fail the same way on every reload.
    toast.error(located.error.data?.code === 'NOT_FOUND'
      ? key.startsWith('event:') ? EVENT_GONE : 'Calendario non più disponibile'
      : getTrpcErrorMessage(located.error));
    onDone();
  }, [key, located.error, onDone]);

  useEffect(() => {
    if (!key) {
      refetchedFor.current = null;
      return;
    }
    if (!found || !inContext || located.isFetching) return;
    if (!selectedBrandIds.includes(found.brandId)) {
      onSelectBrand(found.brandId);
      return;
    }
    const { event } = found;
    if (!event) {
      onDone();
      return;
    }
    if (!zone || !events || isFetching) return;
    if (events.some(e => e.id === event.id)) {
      onOpenEvent(event.id);
      // An all-day event's stored day, a timed one's start day in the profile zone (ADR-035).
      onDone(eventCalendarDays(new Date(event.startAt), event.endAt ? new Date(event.endAt) : null, event.allDay, zone)[0]);
    } else if (refetchedFor.current !== key) {
      // Created after the list was loaded: fetched again once before giving up.
      refetchedFor.current = key;
      refetch();
    } else {
      toast.error(EVENT_GONE);
      onDone();
    }
  }, [key, found, inContext, located.isFetching, selectedBrandIds, zone, events, isFetching, refetch, onSelectBrand, onOpenEvent, onDone]);

  if (!found || inContext) return null;
  return (
    <Alert className="mb-4">
      <Info className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span className="mr-auto">
          {found.event ? `"${found.event.title}" è nel calendario ${found.label}` : `Questa notifica riguarda il calendario ${found.label}`}
        </span>
        <Button size="sm" disabled={isPending} onClick={() => setContext({ brandId: found.brandId, seasonId: found.seasonId })}>
          Apri in {found.label}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDone()}>
          Ignora
        </Button>
      </AlertDescription>
    </Alert>
  );
}
