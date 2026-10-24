'use client';

import { useState } from 'react';

import type { RouterOutputs } from '@luke/api';

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
import { trpc } from '../../../../../lib/trpc';
import { usePhaseCatalog } from '../_hooks/usePhaseCatalog';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: (phaseId: string | null, note?: string) => void;
  /** The phase in the row form, saved or not. */
  currentPhaseId: string | null;
  /** The planning group in the row form, saved or not. */
  currentPlanningGroupId: string | undefined;
  /** The row as saved: the state its criticality, and so the proposal, describes. */
  saved: { rowId: string; phaseId: string | null; planningGroupId: string };
}

type RowCriticality = RouterOutputs['phaseAlert']['criticalityForRow'];

/**
 * Where the row goes next, from its criticality: the active phase when the row is not at it yet
 * (no phase, or a phase its group does not plan), else the next one. None for a concluded row or
 * one with no calendar, and none when that event carries no phase.
 */
function proposedPhaseId(criticality: RowCriticality | undefined, savedPhaseId: string | null): string | null {
  if (criticality?.state !== 'active') return null;
  return criticality.phaseId !== savedPhaseId ? criticality.phaseId : criticality.nextPhase?.phaseId ?? null;
}

/**
 * Informed phase change for a single row — a purely local picker, no network mutation: it hands
 * the selection (and the optional note) back to the drawer via `onChanged`, which buffers it in the
 * row form. The real commit happens only on the drawer Save (same transaction as the row); the
 * note ends up in the consolidated audit log metadata only if the phase really changed.
 *
 * It opens on the proposed next phase (#159) until the user picks one. The proposal reads the
 * saved row's criticality, so it applies only while the form's phase and group are the saved ones.
 */
export function ChangePhaseDialog({ open, onClose, onChanged, currentPhaseId, currentPlanningGroupId, saved }: Props) {
  const { phases } = usePhaseCatalog();
  const pristine = currentPhaseId === saved.phaseId && currentPlanningGroupId === saved.planningGroupId;
  // The drawer's `CriticalitySituation` holds the same query: this reads its cache. While it
  // refetches (after a save invalidated it), the cached data may describe the row before that save.
  const { data: criticality, isFetching } = trpc.phaseAlert.criticalityForRow.useQuery(
    { rowId: saved.rowId },
    { enabled: open && pristine }
  );
  const proposed = pristine && !isFetching ? proposedPhaseId(criticality, saved.phaseId) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // A retired phase is not among the options.
  const phaseId = picked ?? (phases.some(p => p.id === proposed) ? proposed : currentPhaseId) ?? NO_PHASE_VALUE;
  const resolvedPhaseId = phaseId === NO_PHASE_VALUE ? null : phaseId;
  const unchanged = resolvedPhaseId === currentPhaseId;

  const reset = () => { setPicked(null); setNote(''); };
  const close = () => { onClose(); reset(); };

  const handleConfirm = () => {
    onChanged(resolvedPhaseId, note.trim() || undefined);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
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
            <Label htmlFor="phase-change-select">Nuova fase</Label>
            <PhaseSelect id="phase-change-select" value={phaseId} onValueChange={setPicked} phases={phases} noneLabel="—" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phase-change-note">Note (facoltative)</Label>
            <Textarea id="phase-change-note" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Motivo del cambio, contesto…" className="resize-none text-sm" rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>
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
