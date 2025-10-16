/**
 * Utility per logging di debug condizionale
 * Emette log solo in development o con flag NEXT_PUBLIC_LUKE_DEBUG_UI=true
 */

/**
 * Log di debug condizionale
 * @param args - Argomenti da loggare
 */
export function debugLog(...args: unknown[]) {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_LUKE_DEBUG_UI === 'true'
  ) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

/**
 * Warning di debug condizionale
 * @param args - Argomenti da loggare
 */
export function debugWarn(...args: unknown[]) {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_LUKE_DEBUG_UI === 'true'
  ) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}

/**
 * Error di debug condizionale
 * @param args - Argomenti da loggare
 */
export function debugError(...args: unknown[]) {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_LUKE_DEBUG_UI === 'true'
  ) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
}
