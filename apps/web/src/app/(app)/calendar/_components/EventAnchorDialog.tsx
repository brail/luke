'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../../components/ui/button';
import { Checkbox } from '../../../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '../../../../components/ui/radio-group';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  eventId: string;
  eventTitle: string;
  brandId: string;
  seasonId: string;
  /** Current anchors for this event, used to pre-select the scope. */
  currentAnchors: { entityType: string; entityId: string }[];
}

/**
 * Scopes a calendar event to either the whole collection layout or a specific subset of rows,
 * via `CalendarEventAnchor` (reused as-is — no new mutation). Rows not selected are unaffected
 * by this event when the alert/phase-resolution engine evaluates "which events apply to this row".
 *
 * The parent must pass `key={eventId}` so switching to a different event remounts this dialog
 * and re-derives `scope`/`selectedRowIds` from that event's `currentAnchors`.
 */
export function EventAnchorDialog({ open, onClose, onSaved, eventId, eventTitle, brandId, seasonId, currentAnchors }: Props) {
  const isCurrentlyScoped = currentAnchors.some(a => a.entityType === 'COLLECTION_LAYOUT_ROW');
  const [scope, setScope] = useState<'all' | 'subset'>(isCurrentlyScoped ? 'subset' : 'all');
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(
    () => new Set(currentAnchors.filter(a => a.entityType === 'COLLECTION_LAYOUT_ROW').map(a => a.entityId))
  );

  const { data: layout, isLoading } = trpc.collectionLayout.get.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );
  const allRows = layout?.groups.flatMap(g => g.rows) ?? [];

  const setAnchorsMutation = trpc.seasonCalendar.setEventAnchors.useMutation({
    onSuccess: () => {
      toast.success('Ambito aggiornato');
      onSaved();
      onClose();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const toggleRow = (rowId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const handleSave = () => {
    const anchors = scope === 'all'
      ? []
      : [...selectedRowIds].map(entityId => ({ entityType: 'COLLECTION_LAYOUT_ROW' as const, entityId }));
    setAnchorsMutation.mutate({ eventId, anchors });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Ambito — {eventTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup value={scope} onValueChange={v => setScope(v as 'all' | 'subset')}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="all" id="anchor-all" />
              <label htmlFor="anchor-all" className="text-sm cursor-pointer">Tutte le righe del layout</label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="subset" id="anchor-subset" />
              <label htmlFor="anchor-subset" className="text-sm cursor-pointer">Solo un sottoinsieme di righe</label>
            </div>
          </RadioGroup>

          {scope === 'subset' && (
            <ScrollArea className="h-56 rounded-md border">
              <div className="p-2 space-y-0.5">
                {isLoading && <p className="text-sm text-muted-foreground p-4 text-center">Caricamento…</p>}
                {!isLoading && allRows.length === 0 && (
                  <p className="text-sm text-muted-foreground p-4 text-center">Nessuna riga nel layout</p>
                )}
                {allRows.map(row => (
                  <div key={row.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50">
                    <Checkbox
                      checked={selectedRowIds.has(row.id)}
                      onCheckedChange={() => toggleRow(row.id)}
                    />
                    <span className="text-sm flex-1 truncate">{row.line}{row.article ? ` / ${row.article}` : ''}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={setAnchorsMutation.isPending}>
            Annulla
          </Button>
          <Button
            onClick={handleSave}
            disabled={setAnchorsMutation.isPending || (scope === 'subset' && selectedRowIds.size === 0)}
          >
            {setAnchorsMutation.isPending ? 'Salvataggio…' : 'Salva ambito'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
