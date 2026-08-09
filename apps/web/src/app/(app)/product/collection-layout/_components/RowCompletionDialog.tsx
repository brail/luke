'use client';

import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';

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

interface Props {
  open: boolean;
  mode: 'complete' | 'reopen';
  /** Fasi che la riga non ha attraversato — vuoto quando è già all'ultima milestone pianificata. */
  missingPhases: { value: string; label: string }[];
  onClose: () => void;
  onConfirm: (note: string) => void;
  isPending?: boolean;
}

/**
 * Conferma motivata per la conclusione e la riapertura di una riga. Presentazionale: restituisce la
 * motivazione al chiamante e non conosce la mutation, come `ChangePhaseDialog`.
 *
 * La motivazione è obbligatoria in entrambi i versi — la conclusione è l'unico momento in cui
 * l'esito viene fissato, e riaprire annulla un esito già registrato: senza un perché l'audit log
 * direbbe solo che è successo. Stesso schema del dialog "Annulla evento" del calendario.
 *
 * Con `missingPhases` non vuoto la conferma diventa una forzatura dichiarata: concludere non è
 * vietato (sarebbe aggirabile saltando all'ultima fase), ma l'utente vede quali fasi sta saltando e
 * il server le registra nell'audit log.
 */
export function RowCompletionDialog({ open, mode, missingPhases, onClose, onConfirm, isPending }: Props) {
  const [note, setNote] = useState('');

  const close = () => {
    setNote('');
    onClose();
  };

  const isForcing = mode === 'complete' && missingPhases.length > 0;
  const title = mode === 'complete' ? 'Concludi riga' : 'Riapri riga';
  const confirmLabel = isForcing ? 'Forza conclusione' : title;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-[440px]"> {/* px: dialog width tuned to this form's content; no exact Tailwind max-w scale match */}
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isForcing ? (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                A questa riga mancano queste fasi prima di poter considerare concluso lo sviluppo:{' '}
                <strong>{missingPhases.map(p => p.label).join(', ')}</strong>. Confermi di voler
                forzare la conclusione?
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {mode === 'complete'
                ? 'La riga esce dal countdown di fase e mostra l’esito rispetto all’ultima milestone pianificata. La motivazione è obbligatoria.'
                : 'La riga torna in lavorazione e ricomincia a essere misurata contro le scadenze di fase. La motivazione è obbligatoria.'}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="row-completion-note">Motivazione *</Label>
            <Textarea
              id="row-completion-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={mode === 'complete' ? 'Perché la riga si considera conclusa…' : 'Perché la riga viene riaperta…'}
              className="resize-none text-sm"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={isPending}>
            Annulla
          </Button>
          <Button
            variant={isForcing ? 'destructive' : 'default'}
            onClick={() => onConfirm(note.trim())}
            disabled={isPending || !note.trim()}
          >
            {isPending ? 'Salvataggio…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
