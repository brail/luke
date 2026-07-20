'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';

import { Button } from '../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../../components/ui/dialog';
import { useCopyToClipboard } from '../../../../hooks/useCopyToClipboard';
import { trpc } from '../../../../lib/trpc';

interface Props {
  open: boolean;
  onClose: () => void;
  calendarId: string | undefined;
}

function subscribeUrl(googleCalendarId: string): string {
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(googleCalendarId)}`;
}

/**
 * Dialog listing the Google Calendars provisioned for this season calendar (one per
 * company function), with a per-section "add to my Google Calendar" link and a
 * copy-to-clipboard fallback for the calendar ID.
 */
export function GoogleCalendarSubscribeDialog({ open, onClose, calendarId }: Props) {
  const { copy, copiedValue } = useCopyToClipboard();

  const { data: bindings, isLoading } = trpc.seasonCalendar.listGoogleCalendarBindings.useQuery(
    { calendarId: calendarId ?? '' },
    { enabled: open && !!calendarId, staleTime: 5 * 60 * 1000 }
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Iscriviti ai calendari Google</DialogTitle>
          <DialogDescription>
            Aggiungi le sezioni al tuo Google Calendar personale. L&apos;accesso è di sola lettura.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {isLoading && <p className="text-sm text-muted-foreground">Caricamento…</p>}
          {!isLoading && bindings?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessun calendario Google ancora provisioned per questa stagione. Sincronizza almeno un evento pubblico per crearli.
            </p>
          )}
          {bindings?.map(b => (
            <div key={b.companyFunctionId} className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <span className="text-sm font-medium truncate">{b.functionName}</span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Copia ID calendario"
                  onClick={() => copy(b.googleCalendarId)}
                >
                  {copiedValue === b.googleCalendarId ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={subscribeUrl(b.googleCalendarId)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} className="mr-1.5" />Aggiungi
                  </a>
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
