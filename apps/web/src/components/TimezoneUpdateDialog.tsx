'use client';

import { Globe } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';

import { isValidTimeZone, sameTimeZone } from '@luke/core';

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

/** The browser's zone, or `null` when it cannot be read or is not one the server accepts. */
function readBrowserZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : null;
  } catch (error) {
    debugWarn('Unable to detect the browser timezone:', error);
    return null;
  }
}

/**
 * Auto-shown dialog that prompts the user to update their timezone when a browser mismatch is detected.
 *
 * Judged once per session, when the profile zone first arrives, and shown 2 seconds later to avoid a
 * flash. Compares the browser's `Intl.DateTimeFormat` timezone with the stored profile zone as zones,
 * not strings: an alias of the same zone (`Asia/Kolkata`, `Asia/Calcutta`) is no mismatch. Reads the
 * stored value through its own `me.get` rather than `useFormatDate`, deliberately: a zone this
 * browser cannot use is exactly the one worth replacing, and this globally mounted dialog must not
 * raise the hook's "dates not shown" toast on every page. Calls `me.updateTimezone` on confirmation.
 */
export function TimezoneUpdateDialog() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const refresh = useRefresh();

  // Use the fresh data from the API instead of the NextAuth session
  const { data: userData } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken,
    staleTime: 5 * 60 * 1000, // 5 minutes - reduces API requests
  });
  const userTz = userData?.timezone;

  // Judged once per session, when the profile zone first arrives (React's pattern for state set
  // during render): a zone the user picks later is not questioned. Logging out starts over.
  const [judged, setJudged] = useState<{ detected: string | null } | null>(null);
  if (status === 'unauthenticated' && judged) {
    setJudged(null);
    setOpen(false);
  }
  if (status === 'authenticated' && session?.user && userTz && !judged) setJudged({ detected: readBrowserZone() });
  // A mismatch only when the zones differ: one the profile resolves in the meantime (another tab, the
  // profile form) drops out.
  const detectedTimezone = judged?.detected && userTz && !sameTimeZone(judged.detected, userTz) ? judged.detected : null;

  // Mutation tRPC
  const updateTimezoneMutation = trpc.me.updateTimezone.useMutation();

  const { mutate: updateTimezone, isPending: isUpdatingTimezone } =
    useStandardMutation({
      mutateFn: updateTimezoneMutation.mutateAsync,
      invalidate: refresh.timeZone,
      onSuccessMessage: 'Fuso orario aggiornato con successo',
      onErrorMessage: 'Errore aggiornamento',
      onSuccess: () => setOpen(false),
    });

  // Shown 2 seconds after the mismatch is found, to avoid a flash on load; once closed, in any way,
  // it stays closed.
  useEffect(() => {
    if (!detectedTimezone) return;
    const timer = setTimeout(() => setOpen(true), 2000);
    return () => clearTimeout(timer);
  }, [detectedTimezone]);

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
    setJudged({ detected: null });
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
              {userTz}
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
