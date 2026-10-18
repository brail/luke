'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { PlanningGroupSelect } from '../../../../../components/PlanningGroupSelect';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';

interface PlanningGroupOption { id: string; name: string; isDefault: boolean; }

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: (planningGroupId: string) => void;
  planningGroups: PlanningGroupOption[];
  isLoading?: boolean;
}

/**
 * Planning group change for a single row — a purely local picker, no network mutation: it hands
 * the selection back to the drawer via `onChanged`, which buffers it in the row form. The real
 * commit happens only on the drawer Save (same transaction as the row). `planningGroups` comes
 * from the drawer, which already fetched them for the form — no query of its own.
 */
export function ChangePlanningGroupDialog({ open, onClose, onChanged, planningGroups, isLoading }: Props) {
  const [planningGroupId, setPlanningGroupId] = useState('');

  const handleAssign = () => {
    if (!planningGroupId) {
      toast.error('Seleziona un gruppo di pianificazione');
      return;
    }
    onChanged(planningGroupId);
    setPlanningGroupId('');
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setPlanningGroupId(''); } }}>
      <DialogContent className="sm:max-w-[420px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>Cambia gruppo di pianificazione</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Determina quali eventi di calendario si applicano a questa riga. Il cambio è effettivo solo
            salvando la riga.
          </p>

          <PlanningGroupSelect
            value={planningGroupId}
            onValueChange={setPlanningGroupId}
            groups={planningGroups}
            loading={isLoading}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={handleAssign} disabled={!planningGroupId}>
            Assegna
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
