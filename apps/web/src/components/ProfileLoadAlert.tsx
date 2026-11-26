'use client';

import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useFormatDate } from '../hooks/useFormatDate';
import { isSessionEnded } from '../lib/sessionEnd';
import { trpc } from '../lib/trpc';
import { getTrpcErrorMessage } from '../lib/trpcErrorMessages';

import { LogoutForm } from './system/LogoutForm';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

/**
 * The shell's notice that the profile (`me.get`) could not load (#239): what failed, that dates
 * stay hidden without it, when a retry makes sense — after the server's `retryAfterSeconds` for a
 * 429 — a retry action, and `Esci`. Reads the query `useFormatDate` already holds, so it sends no
 * request of its own. A `sessionEnded` answer shows nothing: the browser is already signing out.
 */
export function ProfileLoadAlert() {
  const { error } = useFormatDate();
  const utils = trpc.useUtils();
  const [retrying, setRetrying] = useState(false);
  // The error whose wait has elapsed: one timer per refusal, no ticking countdown.
  const [waitedFor, setWaitedFor] = useState<unknown>(null);

  const httpStatus = error?.data?.httpStatus;
  const waitSeconds = httpStatus === 429 ? error?.data?.retryAfterSeconds : undefined;

  useEffect(() => {
    if (waitSeconds === undefined) return;
    const timer = setTimeout(() => setWaitedFor(error), waitSeconds * 1000);
    return () => clearTimeout(timer);
  }, [error, waitSeconds]);

  if (!error || isSessionEnded(error)) return null;

  const waiting = waitSeconds !== undefined && waitedFor !== error;
  const cause =
    httpStatus === 429
      ? 'Troppe richieste in poco tempo.'
      : httpStatus === undefined
        ? 'Il server non risponde: controlla la connessione.'
        : getTrpcErrorMessage(error);
  const seconds = Math.ceil(waitSeconds ?? 0);

  const retry = () => {
    setRetrying(true);
    void utils.me.get.refetch().finally(() => setRetrying(false));
  };

  return (
    <Alert variant="destructive" className="mx-6 mt-4 w-auto">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Profilo non caricato</AlertTitle>
      <AlertDescription>
        <p>{cause}</p>
        <p>Date e orari restano nascosti finché il profilo non è caricato.</p>
        {waiting && (
          <p>
            Puoi riprovare tra circa {seconds} {seconds === 1 ? 'secondo' : 'secondi'}.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <Button onClick={retry} disabled={waiting || retrying}>
            {retrying ? 'Riprovo…' : 'Riprova'}
          </Button>
          <LogoutForm />
        </div>
      </AlertDescription>
    </Alert>
  );
}
