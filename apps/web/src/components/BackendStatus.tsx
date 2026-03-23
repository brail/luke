'use client';

import { useAppConfig } from '../hooks/use-app-config';
import { cn } from '../lib/utils';

interface BackendStatusProps {
  className?: string;
}

/**
 * Indicatore di connettività al backend.
 *
 * - Dev:  dot colorato + testo ("v1.2.3 · development" oppure messaggio di errore)
 * - Prod: solo dot colorato; in caso di errore aggiunge testo generico
 */
export function BackendStatus({ className }: BackendStatusProps) {
  const { isLoading, hasError } = useAppConfig();
  const isDev = process.env.NODE_ENV === 'development';
  const version = process.env.NEXT_PUBLIC_APP_VERSION;

  const dotClass = cn(
    'h-2 w-2 rounded-full flex-shrink-0',
    isLoading && 'bg-yellow-400 animate-pulse',
    !isLoading && hasError && 'bg-red-500',
    !isLoading && !hasError && 'bg-green-500',
  );

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className={dotClass} />

      {isLoading && isDev && <span>Connessione...</span>}

      {!isLoading && hasError && (
        <span>
          {isDev ? 'Backend non raggiungibile' : 'Servizio non disponibile'}
        </span>
      )}

      {!isLoading && !hasError && isDev && (
        <span>
          {[version, 'development'].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
  );
}
