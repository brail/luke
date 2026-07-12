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
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

interface Props {
  open: boolean;
  onClose: () => void;
  onAssigned: (planningGroupId: string) => void;
  brandId: string;
  seasonId: string;
  collectionLayoutId: string;
  rowIds: string[];
}

/**
 * Bulk-assigns the selected collection layout rows to a planning group.
 *
 * Invalidates the layout and phase-alert criticality caches on success — moving a row's group
 * changes which calendar events apply to it, so the criticality badges must refresh too.
 */
export function AssignPlanningGroupDialog({ open, onClose, onAssigned, brandId, seasonId, collectionLayoutId, rowIds }: Props) {
  const [planningGroupId, setPlanningGroupId] = useState('');

  const { data: planningGroups = [], isLoading } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );

  const utils = trpc.useUtils();

  const assignMutation = trpc.collectionLayout.rows.bulkAssignPlanningGroup.useMutation({
    onSuccess: data => {
      toast.success(`${data.count} righe assegnate al gruppo`);
      void utils.collectionLayout.get.invalidate({ brandId, seasonId });
      void utils.phaseAlert.criticalityForLayout.invalidate({ collectionLayoutId });
      rowIds.forEach(rowId => void utils.phaseAlert.criticalityForRow.invalidate({ rowId }));
      onAssigned(planningGroupId);
      setPlanningGroupId('');
    },
    onError: err => toast.error(getTrpcErrorMessage(err)),
  });

  const handleAssign = () => {
    if (!planningGroupId) {
      toast.error('Seleziona un gruppo di pianificazione');
      return;
    }
    assignMutation.mutate({ rowIds, planningGroupId });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Assegna a gruppo di pianificazione</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {rowIds.length} riga{rowIds.length === 1 ? '' : 'e'} selezionat{rowIds.length === 1 ? 'a' : 'e'} verranno
            spostate nel gruppo scelto — determina quali eventi di calendario si applicano a queste righe.
          </p>

          <PlanningGroupSelect
            value={planningGroupId}
            onValueChange={setPlanningGroupId}
            groups={planningGroups}
            loading={isLoading}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={assignMutation.isPending}>
            Annulla
          </Button>
          <Button onClick={handleAssign} disabled={assignMutation.isPending || !planningGroupId}>
            {assignMutation.isPending ? 'Assegnazione…' : 'Assegna'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
