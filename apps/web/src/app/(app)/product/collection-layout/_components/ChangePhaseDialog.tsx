'use client';

import { useState } from 'react';

import { NO_PHASE_VALUE, PhaseSelect } from '../../../../../components/PhaseSelect';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Label } from '../../../../../components/ui/label';
import { Textarea } from '../../../../../components/ui/textarea';
import { usePhaseCatalog } from '../_hooks/usePhaseCatalog';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: (phaseId: string | null, note?: string) => void;
  currentPhaseId: string | null;
}

/**
 * Informed phase change for a single row — a purely local picker, no network mutation: it hands
 * the selection (and the optional note) back to the drawer via `onChanged`, which buffers it in the
 * row form. The real commit happens only on the drawer Save (same transaction as the row); the
 * note ends up in the consolidated audit log metadata only if the phase really changed.
 */
export function ChangePhaseDialog({ open, onClose, onChanged, currentPhaseId }: Props) {
  const { phases } = usePhaseCatalog();
  const [phaseId, setPhaseId] = useState(currentPhaseId ?? NO_PHASE_VALUE);
  const [note, setNote] = useState('');

  const resolvedPhaseId = phaseId === NO_PHASE_VALUE ? null : phaseId;
  const unchanged = resolvedPhaseId === currentPhaseId;

  const handleConfirm = () => {
    onChanged(resolvedPhaseId, note.trim() || undefined);
    setNote('');
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setPhaseId(currentPhaseId ?? NO_PHASE_VALUE); setNote(''); } }}>
      <DialogContent className="sm:max-w-[440px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Cambia fase</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            La riga viene spostata sulla nuova fase e la situazione (banda di criticità, scadenza) viene
            ricalcolata di conseguenza. Il cambio è effettivo solo salvando la riga.
          </p>

          <div className="space-y-1.5">
            <Label>Nuova fase</Label>
            <PhaseSelect value={phaseId} onValueChange={setPhaseId} phases={phases} noneLabel="—" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phase-change-note">Note (facoltative)</Label>
            <Textarea id="phase-change-note" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Motivo del cambio, contesto…" className="resize-none text-sm" rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={handleConfirm} disabled={unchanged}>
            Conferma cambio fase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
