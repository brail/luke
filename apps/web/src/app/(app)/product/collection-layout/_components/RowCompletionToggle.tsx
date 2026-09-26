'use client';

import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { formatDate } from '@luke/core';

import { PermissionButton } from '../../../../../components/PermissionButton';
import { useToast } from '../../../../../hooks/useToast';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

import { RowCompletionDialog } from './RowCompletionDialog';

interface Props {
  rowId: string;
  completedAt: Date | string | null;
  canUpdate: boolean;
  /** Refetches the layout and the alert queries — the badge and the dashboards both read from them. */
  onChanged: () => void;
}

/**
 * "Concludi riga" / "Riapri" in the drawer Planning band. Completion is an explicit state the
 * alert engine cannot infer: a row stopped at the last phase has *reached* it, not finished.
 * Once completed it shows the frozen outcome instead of the countdown and stops generating delay
 * notifications.
 *
 * Both directions go through `RowCompletionDialog`, which demands a reason: they write
 * immediately, outside the drawer's buffered Save, and they are the only actions that fix or
 * cancel an outcome. Before completing, `completionPreview` is queried to learn which phases the
 * row is skipping — the list feeds the warning and, if the user proceeds, `force`.
 */
export function RowCompletionToggle({ rowId, completedAt, canUpdate, onChanged }: Props) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isCompleted = completedAt !== null;

  // Only when completing, and only with the dialog open: reopening skips nothing, and a row open
  // in the drawer must not pay for a query that only serves whoever presses the button.
  const { data: preview } = trpc.phaseAlert.completionPreview.useQuery(
    { rowId },
    { enabled: dialogOpen && !isCompleted, staleTime: 60 * 1000 }
  );
  const missingPhases = preview?.missingPhases ?? [];

  const mutation = trpc.collectionLayout.rows.setCompleted.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(variables.completed ? 'Riga conclusa' : 'Riga riaperta');
      setDialogOpen(false);
      onChanged();
    },
    onError: error => {
      toast.error('Operazione non riuscita', { description: getTrpcErrorMessage(error) });
    },
  });

  return (
    <div className="flex items-center gap-2">
      {isCompleted && (
        <span className="text-xs text-muted-foreground">
          Conclusa il {formatDate(new Date(completedAt))}
        </span>
      )}
      <PermissionButton
        type="button"
        variant="outline"
        size="sm"
        hasPermission={canUpdate}
        tooltip={`Non hai i permessi per ${isCompleted ? 'riaprire' : 'concludere'} una riga`}
        disabled={mutation.isPending}
        onClick={() => setDialogOpen(true)}
      >
        {isCompleted ? <RotateCcw size={14} className="mr-1" /> : <CheckCircle2 size={14} className="mr-1" />}
        {isCompleted ? 'Riapri' : 'Concludi riga'}
      </PermissionButton>

      <RowCompletionDialog
        open={dialogOpen}
        mode={isCompleted ? 'reopen' : 'complete'}
        missingPhases={missingPhases}
        isPending={mutation.isPending}
        onClose={() => setDialogOpen(false)}
        onConfirm={note =>
          mutation.mutate({
            rowId,
            completed: !isCompleted,
            note,
            // The real list is recalculated by the server: here `force` only declares the warning was
            // viewed and accepted.
            ...(missingPhases.length > 0 ? { force: true } : {}),
          })
        }
      />
    </div>
  );
}
