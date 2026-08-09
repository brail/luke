import React from 'react';

import { PageHeader } from '../PageHeader';

interface SettingsFormShellProps {
  title: string;
  description?: string;
  isLoading?: boolean;
  error?: Error | { message: string } | null;
  children: React.ReactNode;
}

/**
 * Layout shell for settings pages that handles loading and error states before rendering the form.
 *
 * Renders a loading message while `isLoading` is true, an error message when `error` is set,
 * or the `children` form content otherwise. Includes `PageHeader` in all states.
 */
export function SettingsFormShell({
  title,
  description,
  isLoading,
  error,
  children,
}: SettingsFormShellProps) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} description={description} />
        <div className="text-center py-8 text-muted-foreground">
          Caricamento configurazione...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={title} description={description} />
        <div className="text-center py-8">
          <div className="text-destructive text-lg font-semibold mb-2">
            Errore nel caricamento
          </div>
          <p className="text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  );
}
