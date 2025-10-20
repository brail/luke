'use client';

import { toast } from 'sonner';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { trpc } from '../../../../../lib/trpc';

interface Props {
  userId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog riusabile per conferma invio email verifica post-creazione utente
 * Usa endpoint admin requestEmailVerificationAdmin
 */
export function SendVerificationDialog({ userId, open, onOpenChange }: Props) {
  const sendVerifyMutation =
    trpc.auth.requestEmailVerificationAdmin.useMutation();

  const handleSend = async () => {
    if (!userId) return;
    try {
      await sendVerifyMutation.mutateAsync({ userId });
      toast.success('Email di verifica inviata');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Impossibile inviare email. Verifica SMTP.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Utente creato con successo</DialogTitle>
          <DialogDescription>
            Vuoi inviare un'email di verifica all'utente?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Salta
          </Button>
          <Button onClick={handleSend} disabled={sendVerifyMutation.isPending}>
            {sendVerifyMutation.isPending ? 'Invio...' : 'Invia Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
