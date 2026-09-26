/**
 * Helper utilities for the AppConfig management UI.
 * Provides validators and formatters used by the configuration pages. The key rules themselves
 * (prefixes, format, keys that cannot be deleted) live in `@luke/core`, shared with the API.
 */

import { CONFIG_ROUTER_KEY_REGEX, CONFIG_ROUTER_PREFIXES, isAppConfigKey } from '@luke/core';

/**
 * Extracts the category prefix from a config key (the segment before the first `.`).
 * Returns `'unknown'` when the key has no prefix.
 */
export function getCategoryFromKey(key: string): string {
  const match = key.match(/^([^.]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Formats a config value for display.
 * Encrypted values are replaced with `••••••`. Plain values are truncated to
 * `truncate` characters (default 30; JSON blobs use at least 100).
 *
 * @param isEncrypted - When `true`, returns the redaction placeholder.
 * @param truncate - Max display length before appending `…`.
 */
export function formatValue(
  value: string | null | undefined,
  isEncrypted: boolean,
  truncate = 30
): string {
  if (isEncrypted) return '••••••';
  if (!value) return '';

  // For JSON, use a higher limit to show more content
  const isJson = value.startsWith('{') && value.includes('"');
  const actualTruncate = isJson ? Math.max(truncate, 100) : truncate;

  return value.length > actualTruncate
    ? value.slice(0, actualTruncate) + '...'
    : value;
}

/**
 * Serialises a JSON string in compact form with spaces after `,` and `:` to
 * allow word-wrapping in narrow containers. Returns the original string on parse error.
 */
export function formatJsonCompact(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    const compact = JSON.stringify(parsed, null, 0);
    // Add spaces after commas and colons to facilitate wrapping
    return compact.replace(/,/g, ', ').replace(/:/g, ': ').replace(/\s+/g, ' '); // Normalize multiple spaces
  } catch {
    return jsonString; // If not valid JSON, return original
  }
}

/**
 * Pretty-prints a JSON string with 2-space indentation.
 * Returns the original string on parse error.
 */
export function formatJsonExpanded(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 2); // With indentation
  } catch {
    return jsonString; // If not valid JSON, return original
  }
}

/**
 * Validates a config key the way `config.set` will: the format (`<category>.<segment>...`) and
 * membership in `AppConfigRegistry`. Returns `{ valid: true }` or `{ valid: false, error: string }`.
 */
export function validateConfigKey(key: string): {
  valid: boolean;
  error?: string;
} {
  if (!key.trim()) {
    return { valid: false, error: 'Chiave non può essere vuota' };
  }

  if (!CONFIG_ROUTER_KEY_REGEX.test(key)) {
    return {
      valid: false,
      error: `Formato chiave non valido. Deve iniziare con una categoria supportata (${CONFIG_ROUTER_PREFIXES.join(', ')})`,
    };
  }

  if (!isAppConfigKey(key)) {
    return { valid: false, error: `Chiave non dichiarata in AppConfigRegistry: ${key}` };
  }

  return { valid: true };
}

/**
 * Validates that a config value is non-empty.
 * Returns `{ valid: true }` or `{ valid: false, error: string }`.
 */
export function validateConfigValue(value: string): {
  valid: boolean;
  error?: string;
} {
  if (!value.trim()) {
    return { valid: false, error: 'Valore non può essere vuoto' };
  }

  return { valid: true };
}

/**
 * Generates a timestamped filename for a config export, e.g.
 * `luke-config-export-2026-06-28T14-30-00.json`.
 */
export function generateExportFileName(): string {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `luke-config-export-${timestamp}.json`;
}

/**
 * Formats a date as `dd/MM/yyyy, HH:mm` using the `it-IT` locale.
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('it-IT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
