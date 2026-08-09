import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind CSS class names, resolving conflicts via `tailwind-merge`
 * and handling conditional expressions via `clsx`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
