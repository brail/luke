import { toast as sonnerToast } from 'sonner';

export interface ToastOptions {
  title?: string;
  description?: string;
  duration?: number;
}

/**
 * Returns a set of typed toast helpers (`success`, `error`, `info`, `warning`)
 * backed by the Sonner library with per-variant default durations.
 *
 * @returns Object with `success`, `error`, `info`, and `warning` methods,
 *   each accepting a message string and an optional `ToastOptions` object.
 */
export function useToast() {
  const toast = {
    success: (message: string, options?: ToastOptions) => {
      sonnerToast.success(message, {
        duration: options?.duration || 4000,
        description: options?.description,
      });
    },
    error: (message: string, options?: ToastOptions) => {
      sonnerToast.error(message, {
        duration: options?.duration || 6000,
        description: options?.description,
      });
    },
    info: (message: string, options?: ToastOptions) => {
      sonnerToast.info(message, {
        duration: options?.duration || 4000,
        description: options?.description,
      });
    },
    warning: (message: string, options?: ToastOptions) => {
      sonnerToast.warning(message, {
        duration: options?.duration || 5000,
        description: options?.description,
      });
    },
  };

  return toast;
}
