'use client';

import Link from 'next/link';
import React, { useEffect } from 'react';

import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { ErrorState } from '../components/system/ErrorState';
import { RetryButton } from '../components/system/RetryButton';
import { Button } from '../components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="it">
      <body>
        <div className="mx-auto max-w-2xl space-y-6 py-10">
          <PageHeader
            title="Si è verificato un errore"
            description="Errore applicativo globale"
          />

          <SectionCard
            title="Errore Applicazione"
            description="Riprova o contatta il supporto"
          >
            <ErrorState
              title="Qualcosa è andato storto"
              description="Riprova l'azione. Se l'errore persiste, contatta il supporto."
              actionSlot={
                <div className="flex gap-3">
                  <RetryButton onRetry={reset} autoFocus />
                  <Link href={'/support' as any} aria-label="Apri supporto">
                    <Button variant="outline">Report issue</Button>
                  </Link>
                </div>
              }
            />
          </SectionCard>
        </div>
      </body>
    </html>
  );
}
