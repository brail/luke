'use client';

import { useAppConfig } from '../hooks/use-app-config';
import { cn } from '../lib/utils';

interface BackendStatusProps {
  className?: string;
}

/**
 * Backend connectivity indicator shown as a colored dot.
 *
 * In development mode it also renders a text label with the app version or error message.
 * In production only the dot is shown; a short generic error text appears on failure.
 */
export function BackendStatus({ className }: BackendStatusProps) {
  const { isLoading, hasError } = useAppConfig();
  const isDev = process.env.NODE_ENV === 'development';

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
    </div>
  );
}
