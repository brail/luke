'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * Loading/empty/error placeholder for a tab's main query. `error` is visually distinct
 * (destructive color + icon) from `empty` (plain muted text) — a failed fetch defaults `data` to
 * `[]` same as a genuinely empty result, so without this the two were indistinguishable.
 */
export function QueryStateMessage({ variant, message }: { variant: 'loading' | 'empty' | 'error'; message: string }) {
  if (variant === 'error') {
    return (
      <div className="py-12 flex flex-col items-center gap-1.5 text-sm text-destructive">
        <AlertTriangle className="h-5 w-5" />
        {message}
      </div>
    );
  }
  return <div className="py-12 text-center text-muted-foreground">{message}</div>;
}
