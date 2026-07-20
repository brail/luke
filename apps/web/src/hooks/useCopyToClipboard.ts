import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

interface CopyOptions {
  successMessage?: string;
  errorMessage?: string;
}

export const COPY_ERROR_MESSAGE = 'Errore durante la copia';

/**
 * Copies text to the clipboard and tracks the last-copied value for 2s so callers can
 * swap a Copy icon for a Check icon. Compare `copiedValue === thisItemValue` — safe for
 * both a single copyable value and a list of independently copyable values.
 */
export function useCopyToClipboard() {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const resetTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const copy = useCallback(async (text: string, options?: CopyOptions) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedValue(text);
      if (options?.successMessage) toast.success(options.successMessage);
      clearTimeout(resetTimeout.current);
      resetTimeout.current = setTimeout(() => {
        setCopiedValue(prev => (prev === text ? null : prev));
      }, 2000);
    } catch {
      if (options?.errorMessage) toast.error(options.errorMessage);
    }
  }, []);

  return { copy, copiedValue };
}
