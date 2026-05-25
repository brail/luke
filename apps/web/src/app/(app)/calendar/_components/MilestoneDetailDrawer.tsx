'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../../../components/ui/sheet';
import { Textarea } from '../../../../components/ui/textarea';
import { trpc } from '../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../lib/trpcErrorMessages';
import { TYPE_LABELS, STATUS_VARIANT } from '../constants';
import { brandColor } from '../utils';

import { MilestoneDialog } from './MilestoneDialog';

interface Milestone {
  id: string;
  title: string;
  description?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  allDay: boolean;
  status: string;
  type: string;
  ownerFunctionId: string;
  publishExternally: boolean;
  brandId?: string | null;
  visibilities: { functionId: string }[];
  notes?: { body: string }[];
}

interface Props {
  milestone: Milestone;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  canUpdate: boolean;
  calendarId: string;
  availableFunctions: { id: string; name: string }[];
  functionsById: Record<string, string>;
}

export function MilestoneDetailDrawer({ milestone, open, onClose, onUpdated, canUpdate, calendarId, availableFunctions, functionsById }: Props) {
  const [noteBody, setNoteBody] = useState(milestone.notes?.[0]?.body ?? '');
  const [noteStatus, setNoteStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Intentionally depends only on milestone.id — avoids resetting while user is typing
  // when notes refetch arrives with the same milestone open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setNoteBody(milestone.notes?.[0]?.body ?? '');
    setNoteStatus('idle');
  }, [milestone.id]);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const upsertNoteMutation = trpc.seasonCalendar.upsertNote.useMutation({
    onSuccess: () => {
      setNoteStatus('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setNoteStatus('idle'), 2500);
    },
    onError: err => {
      setNoteStatus('dirty');
      toast.error(getTrpcErrorMessage(err));
    },
  });

  const saveNote = () => {
    if (noteStatus !== 'dirty') return;
    setNoteStatus('saving');
    upsertNoteMutation.mutate({ eventId: milestone.id, body: noteBody.trim() });
  };

  const deleteMutation = trpc.seasonCalendar.deleteMilestone.useMutation({
    onSuccess: () => {
      toast.success('Milestone eliminata');
      setDeleteOpen(false);
      onClose();
      onUpdated?.();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleNoteChange = (val: string) => {
    setNoteBody(val);
    if (val.trim() !== (milestone.notes?.[0]?.body ?? '').trim()) {
      setNoteStatus('dirty');
    } else {
      setNoteStatus('idle');
    }
  };

  const dateStr = new Date(milestone.startAt).toLocaleDateString('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
      <Sheet open={open} onOpenChange={open => !open && onClose()}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          <SheetHeader className="space-y-3">
            <div className="flex items-start gap-2 flex-wrap">
              {milestone.brandId && (
                <span
                  className="inline-block w-3 h-3 rounded-full mt-1 shrink-0"
                  style={{ background: brandColor(milestone.brandId) }}
                />
              )}
              <SheetTitle className="leading-snug">{milestone.title}</SheetTitle>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{TYPE_LABELS[milestone.type] ?? milestone.type}</Badge>
              <Badge variant={STATUS_VARIANT[milestone.status] ?? 'outline'}>{milestone.status}</Badge>
              <Badge variant="secondary">{functionsById[milestone.ownerFunctionId] ?? milestone.ownerFunctionId}</Badge>
            </div>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Date */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Data</p>
              <p className="text-sm capitalize">{dateStr}</p>
              {milestone.endAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  → {new Date(milestone.endAt).toLocaleDateString('it-IT')}
                </p>
              )}
            </div>

            {/* Description */}
            {milestone.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Descrizione</p>
                <p className="text-sm whitespace-pre-wrap">{milestone.description}</p>
              </div>
            )}

            {/* Visible functions */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Funzioni coinvolte</p>
              <div className="flex flex-wrap gap-1">
                {milestone.visibilities.map(v => (
                  <Badge key={v.functionId} variant="outline" className="text-xs">
                    {functionsById[v.functionId] ?? v.functionId}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Personal notes */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium text-muted-foreground">I miei appunti</p>
                <span className="text-[11px] tabular-nums">
                  {noteStatus === 'dirty' && (
                    <span className="text-amber-500">● non salvato</span>
                  )}
                  {noteStatus === 'saving' && (
                    <span className="text-muted-foreground animate-pulse">salvataggio…</span>
                  )}
                  {noteStatus === 'saved' && (
                    <span className="text-green-600 dark:text-green-400">✓ salvato</span>
                  )}
                </span>
              </div>
              <Textarea
                value={noteBody}
                onChange={e => handleNoteChange(e.target.value)}
                onBlur={saveNote}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    saveNote();
                  }
                }}
                placeholder="Aggiungi una nota personale…"
                className="text-sm resize-none"
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground/50 mt-1">
                Salvato automaticamente · ⌘↵ per salvare subito
              </p>
            </div>
          </div>

          {canUpdate && (
            <div className="mt-8 flex gap-2 border-t pt-4">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                Modifica
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                Elimina
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {editOpen && (
        <MilestoneDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); onUpdated?.(); }}
          calendarId={calendarId}
          availableFunctions={availableFunctions}
          milestone={milestone}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={open => { if (!open) setDeleteOpen(false); }}
        title="Elimina milestone"
        description={`Sei sicuro di voler eliminare "${milestone.title}"? Questa operazione è irreversibile.`}
        confirmText="Elimina"
        cancelText="Annulla"
        variant="destructive"
        actionType="delete"
        onConfirm={() => deleteMutation.mutate({ id: milestone.id })}
        isLoading={deleteMutation.isPending}
      />
    </>
  );
}
