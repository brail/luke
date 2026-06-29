/**
 * Conditional debug logging utilities for the web app.
 * Output is suppressed in production unless `NEXT_PUBLIC_LUKE_DEBUG_UI=true`.
 * Use these instead of `console.*` directly (CLAUDE.md rule #10).
 */

/**
 * Logs to `console.log` in non-production environments or when
 * `NEXT_PUBLIC_LUKE_DEBUG_UI=true`.
 */
export function debugLog(...args: unknown[]) {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_LUKE_DEBUG_UI === 'true'
  ) {
     
    console.log(...args);
  }
}

/**
 * Logs to `console.warn` in non-production environments or when
 * `NEXT_PUBLIC_LUKE_DEBUG_UI=true`.
 */
export function debugWarn(...args: unknown[]) {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_LUKE_DEBUG_UI === 'true'
  ) {
     
    console.warn(...args);
  }
}

/**
 * Logs to `console.error` in non-production environments or when
 * `NEXT_PUBLIC_LUKE_DEBUG_UI=true`.
 */
export function debugError(...args: unknown[]) {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_LUKE_DEBUG_UI === 'true'
  ) {
     
    console.error(...args);
  }
}


