'use client';

import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { formatDate } from '@luke/core';

import { PermissionButton } from '../../../../../components/PermissionButton';
import { useToast } from '../../../../../hooks/use-toast';
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
 * "Concludi riga" / "Riapri" nella banda Pianificazione del drawer. La conclusione è uno stato
 * esplicito che il motore di alert non può dedurre: una riga ferma sull'ultima fase l'ha
 * *raggiunta*, non finita. Da conclusa mostra l'esito congelato invece del countdown e smette di
 * generare notifiche di ritardo.
 *
 * Entrambe le direzioni passano da `RowCompletionDialog`, che pretende una motivazione: scrivono
 * subito, fuori dal Salva bufferizzato del drawer, e sono le uniche azioni che fissano o annullano
 * un esito. Prima di concludere si interroga `completionPreview` per sapere quali fasi la riga sta
 * saltando — l'elenco alimenta l'avviso e, se si procede, `force`.
 */
export function RowCompletionToggle({ rowId, completedAt, canUpdate, onChanged }: Props) {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const isCompleted = completedAt !== null;

  // Solo in conclusione, e solo a dialog aperto: riaprire non salta nulla, e una riga aperta nel
  // drawer non deve pagare una query che serve solo a chi preme il bottone.
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
