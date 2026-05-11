'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { type PlanningSectionKey } from '@luke/core';

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
import { SECTION_LABELS, TYPE_LABELS, STATUS_VARIANT } from '../constants';
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
  ownerSectionKey: string;
  publishExternally: boolean;
  brandId?: string | null;
  visibilities: { sectionKey: string }[];
  notes?: { body: string }[];
}

interface Props {
  milestone: Milestone;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  canUpdate: boolean;
  calendarId: string;
  accessibleSections: PlanningSectionKey[];
}

export function MilestoneDetailDrawer({ milestone, open, onClose, onUpdated, canUpdate, calendarId, accessibleSections }: Props) {
  const [noteBody, setNoteBody] = useState(milestone.notes?.[0]?.body ?? '');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const upsertNoteMutation = trpc.seasonCalendar.upsertNote.useMutation({
    onSuccess: () => toast.success('Appunto salvato'),
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const deleteMutation = trpc.seasonCalendar.deleteMilestone.useMutation({
    onSuccess: () => {
      toast.success('Milestone eliminata');
      setDeleteOpen(false);
      onClose();
      onUpdated?.();
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleNoteBlur = () => {
    if (noteBody.trim() !== (milestone.notes?.[0]?.body ?? '')) {
      upsertNoteMutation.mutate({ milestoneId: milestone.id, body: noteBody.trim() });
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
              <Badge variant="secondary">{SECTION_LABELS[milestone.ownerSectionKey] ?? milestone.ownerSectionKey}</Badge>
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

            {/* Visible sections */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Sezioni coinvolte</p>
              <div className="flex flex-wrap gap-1">
                {milestone.visibilities.map(v => (
                  <Badge key={v.sectionKey} variant="outline" className="text-xs">
                    {SECTION_LABELS[v.sectionKey] ?? v.sectionKey}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Personal notes */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">I miei appunti</p>
              <Textarea
                value={noteBody}
                onChange={e => setNoteBody(e.target.value)}
                onBlur={handleNoteBlur}
                placeholder="Aggiungi una nota personale…"
                className="text-sm resize-none"
                rows={4}
              />
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
          accessibleSections={accessibleSections}
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
