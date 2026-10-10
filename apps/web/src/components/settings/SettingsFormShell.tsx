import React from 'react';

import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { PageHeader } from '../PageHeader';
import { ErrorState } from '../system/ErrorState';
import { RetryButton } from '../system/RetryButton';

interface SettingsFormShellProps {
  title: string;
  description?: string;
  /** The page's reads have not settled (TanStack `isPending`: a query paused offline included). */
  isPending: boolean;
  /** The first read error, shown through `getTrpcErrorMessage`. */
  error?: unknown;
  /** Every read the form edits has returned data. */
  hasData: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}

/**
 * Layout shell for settings pages: a loading message while the reads are pending, the form once
 * they returned data without error, and otherwise the error with a retry — never the form without
 * a fresh read of the stored data, whose placeholders a save would write over the stored
 * configuration. Includes `PageHeader` in all states.
 */
export function SettingsFormShell({
  title,
  description,
  isPending,
  error,
  hasData,
  onRetry,
  children,
}: SettingsFormShellProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {isPending ? (
        <div className="text-center py-8 text-muted-foreground">
          Caricamento configurazione...
        </div>
      ) : hasData && !error ? (
        children
      ) : (
        <ErrorState
          title="Errore nel caricamento"
          description={error ? getTrpcErrorMessage(error) : undefined}
          actionSlot={<RetryButton onRetry={onRetry} />}
        />
      )}
    </div>
  );
}
