'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

export function ToastDismisser() {
  useEffect(() => {
    const handler = () => toast.dismiss();
    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, []);

  return null;
}
