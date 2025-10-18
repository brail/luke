'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { trpc } from '../lib/trpc';
import { toast } from 'sonner';
import { Globe } from 'lucide-react';

/**
 * Dialog per aggiornare il timezone dell'utente
 * Si mostra automaticamente quando rileva un cambio di timezone dal browser
 */
export function TimezoneUpdateDialog() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // Usa i dati aggiornati dall'API invece della sessione NextAuth
  const { data: userData } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken,
    staleTime: 5 * 60 * 1000, // 5 minuti - riduce richieste API
  });

  const updateMutation = trpc.me.updateTimezone.useMutation({
    onSuccess: async () => {
      toast.success('Fuso orario aggiornato con successo');
      setOpen(false);
      utils.me.get.invalidate(); // Invalida la query per aggiornare i dati
    },
    onError: error => {
      toast.error(`Errore aggiornamento: ${error.message}`);
    },
  });

  useEffect(() => {
    // Rileva timezone dal browser
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const userTz = userData?.timezone; // Usa dati dall'API

      // Rileva se timezone browser è diverso da quello utente

      // Se diverso e sessione attiva, mostra dialog
      if (browserTz && userTz && browserTz !== userTz && session?.user) {
        setDetectedTimezone(browserTz);
        // Mostra dialog solo dopo 2 secondi per evitare flash al caricamento
        setTimeout(() => setOpen(true), 2000);
      }
    } catch (error) {
      // Ignora errori di rilevamento timezone
      console.warn('Impossibile rilevare timezone browser:', error);
    }
  }, [userData?.timezone, session?.user]);

  const handleUpdate = () => {
    if (!detectedTimezone) return;

    // Invia solo il timezone aggiornato
    updateMutation.mutate({
      timezone: detectedTimezone,
    });
  };

  const handleDismiss = () => {
    setOpen(false);
    // Non mostrare più per questa sessione
    setDetectedTimezone(null);
  };

  if (!detectedTimezone || !session?.user) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <DialogTitle>Aggiorna Fuso Orario</DialogTitle>
          </div>
          <DialogDescription>
            Abbiamo rilevato che il tuo fuso orario potrebbe essere cambiato.
            Vuoi aggiornarlo?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <div className="rounded-lg bg-muted p-3">
            <p className="text-sm font-medium">Attuale:</p>
            <p className="text-sm text-muted-foreground">
              {userData?.timezone}
            </p>
          </div>
          <div className="rounded-lg bg-primary/10 p-3">
            <p className="text-sm font-medium text-primary">Rilevato:</p>
            <p className="text-sm text-primary/80">{detectedTimezone}</p>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleDismiss}
            className="w-full sm:w-auto"
          >
            Mantieni attuale
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={updateMutation.isPending}
            className="w-full sm:w-auto"
          >
            {updateMutation.isPending ? 'Aggiornamento...' : 'Aggiorna'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
