'use client';

import { Globe } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';

import { debugWarn } from '../lib/debug';
import { useRefresh } from '../lib/refresh';
import { trpc } from '../lib/trpc';
import { useStandardMutation } from '../lib/useStandardMutation';

import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

/**
 * Auto-shown dialog that prompts the user to update their timezone when a browser mismatch is detected.
 *
 * Appears at most once per session, with a 2-second delay after login to avoid a flash.
 * Compares the browser's `Intl.DateTimeFormat` timezone against the value from `me.get`.
 * Calls `me.updateTimezone` on confirmation.
 */
export function TimezoneUpdateDialog() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  const [hasShownForSession, setHasShownForSession] = useState(false);
  const refresh = useRefresh();

  // Use the fresh data from the API instead of the NextAuth session
  const { data: userData } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken,
    staleTime: 5 * 60 * 1000, // 5 minutes - reduces API requests
  });

  // Mutation tRPC
  const updateTimezoneMutation = trpc.me.updateTimezone.useMutation();

  const { mutate: updateTimezone, isPending: isUpdatingTimezone } =
    useStandardMutation({
      mutateFn: updateTimezoneMutation.mutateAsync,
      invalidate: refresh.me,
      onSuccessMessage: 'Fuso orario aggiornato con successo',
      onErrorMessage: 'Errore aggiornamento',
      onSuccess: () => setOpen(false),
    });

  useEffect(() => {
    // Reset flag when session changes (login/logout)
    if (status === 'unauthenticated') {
      setHasShownForSession(false);
      setDetectedTimezone(null);
      setOpen(false);
      return;
    }

    // Show the dialog only on the first access after login
    if (status === 'authenticated' && !hasShownForSession) {
      // Detect the timezone from the browser
      try {
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const userTz = userData?.timezone; // Use the data from the API

        // If different and the session is active, show the dialog only once per session
        if (browserTz && userTz && browserTz !== userTz && session?.user) {
          setDetectedTimezone(browserTz);
          setHasShownForSession(true);
          // Show dialog only after 2 seconds to avoid flash on load
          setTimeout(() => setOpen(true), 2000);
        }
      } catch (error) {
        // Ignore timezone detection errors
        debugWarn('Unable to detect the browser timezone:', error);
      }
    }
  }, [userData?.timezone, session?.user, status, hasShownForSession]);

  const handleUpdate = () => {
    if (!detectedTimezone) return;

    // Send only the updated timezone
    updateTimezone({
      timezone: detectedTimezone,
    });
  };

  const handleDismiss = () => {
    setOpen(false);
    // Do not show it again for this session
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
            disabled={isUpdatingTimezone}
            className="w-full sm:w-auto"
          >
            {isUpdatingTimezone ? 'Aggiornamento...' : 'Aggiorna'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
