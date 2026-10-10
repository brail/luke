import React from 'react';

import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { PageHeader } from '../PageHeader';
import { ErrorState } from '../system/ErrorState';
import { RetryButton } from '../system/RetryButton';

interface SettingsFormGateProps {
  /** The reads have not settled (TanStack `isPending`: a query paused offline included). */
  isPending: boolean;
  /** The first read error, shown through `getTrpcErrorMessage` when a read has no data. */
  error?: unknown;
  /** Every read the form edits has returned data. */
  hasData: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}

/**
 * The form once every read returned data, a loading message while they are pending, and otherwise
 * the error with a retry — never the form without the stored data, whose placeholders a save would
 * write over the stored configuration. Data comes first: a failed background refetch keeps the data
 * read before (TanStack Query sets `error` and keeps `data`), so it does not take the form away.
 */
export function SettingsFormGate({ isPending, error, hasData, onRetry, children }: SettingsFormGateProps) {
  if (hasData) return children;
  if (isPending) {
    return <div className="text-center py-8 text-muted-foreground">Caricamento configurazione...</div>;
  }
  return (
    <ErrorState
      title="Errore nel caricamento"
      description={error ? getTrpcErrorMessage(error) : undefined}
      actionSlot={<RetryButton onRetry={onRetry} />}
    />
  );
}

interface SettingsFormShellProps extends SettingsFormGateProps {
  title: string;
  description?: string;
}

/** Layout shell for settings pages: `PageHeader` in all states, then the form behind {@link SettingsFormGate}. */
export function SettingsFormShell({ title, description, ...gate }: SettingsFormShellProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <SettingsFormGate {...gate} />
    </div>
  );
}
