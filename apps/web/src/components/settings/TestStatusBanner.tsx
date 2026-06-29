import { CheckCircle, XCircle } from 'lucide-react';
import React from 'react';

import { Alert, AlertDescription } from '../ui/alert';

interface TestStatusBannerProps {
  status?: 'idle' | 'success' | 'error';
  message?: string;
}

/**
 * Alert banner displayed below a settings form after a connection test runs.
 *
 * Renders nothing when `status` is `idle` or `message` is absent.
 * Uses ARIA live region so screen readers announce the result automatically.
 *
 * @param status - `success` renders a green check; `error` renders a destructive alert.
 */
export function TestStatusBanner({
  status = 'idle',
  message,
}: TestStatusBannerProps) {
  if (status === 'idle' || !message) {
    return null;
  }

  return (
    <Alert
      variant={status === 'error' ? 'destructive' : 'default'}
      className="mt-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        {status === 'success' ? (
          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
        ) : (
          <XCircle className="h-4 w-4 mt-0.5" />
        )}
        <AlertDescription className="flex-1">
          <p className="font-medium">
            {status === 'success' ? 'Test riuscito' : 'Test fallito'}
          </p>
          <p className="text-sm mt-1">{message}</p>
        </AlertDescription>
      </div>
    </Alert>
  );
}
