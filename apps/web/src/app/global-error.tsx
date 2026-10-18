'use client';

import React, { useEffect } from 'react';

import { PageHeader } from '../components/PageHeader';
import { SectionCard } from '../components/SectionCard';
import { ErrorState } from '../components/system/ErrorState';
import { RetryButton } from '../components/system/RetryButton';
import { debugError } from '../lib/debug';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    debugError(error);
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
              actionSlot={<RetryButton onRetry={reset} autoFocus />}
            />
          </SectionCard>
        </div>
      </body>
    </html>
  );
}
