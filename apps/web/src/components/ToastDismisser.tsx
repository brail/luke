'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Invisible component that dismisses all active toasts on any document click.
 *
 * Attaches a capture-phase click listener to `document` so that clicking anywhere
 * clears outstanding Sonner toasts. Renders nothing.
 */
export function ToastDismisser() {
  useEffect(() => {
    const handler = () => toast.dismiss();
    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, []);

  return null;
}
