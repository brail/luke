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
 * Cambio gruppo di pianificazione per una singola riga — picker puramente locale, nessuna mutation
 * di rete: riporta la selezione al drawer via `onChanged`, che la bufferizza nel form della riga. Il
 * commit reale avviene solo al Salva del drawer (stessa transazione della riga). `planningGroups`
 * arriva dal drawer, che le ha già fetchate per il form — nessuna query propria.
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
