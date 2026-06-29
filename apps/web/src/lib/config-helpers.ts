/**
 * Helper utilities for the AppConfig management UI.
 * Provides constants, validators, and formatters used by the configuration pages.
 * Must be kept in sync with the backend config router for key-format rules.
 */

/**
 * Supported top-level config categories (must match the backend).
 */
export const CATEGORIES = [
  'auth',
  'app',
  'security',
  'mail',
  'storage',
  'pricing',
  'ui',
  'integrations',
] as const;

/**
 * Patterns matching config keys that cannot be deleted.
 * Must stay in sync with the backend `CRITICAL_CONFIG_KEYS` list.
 */
export const CRITICAL_KEY_PATTERNS = [
  /^auth\.ldap\..+/,
  /^auth\.oidc\..+/,
  /^jwt\..+/,
  /^nextauth\..+/,
  /^mail\.smtp\..+/,
  /^storage\.(smb|gdrive)\..+/,
  /^security\..+/,
  /^app\.(baseUrl|encryptionKey)$/,
];

/**
 * Builds the regex used to validate config key format: `<category>.<segment>[.<segment>...]`.
 * Must stay in sync with the backend key-format validation.
 */
export function getKeyRegex(): RegExp {
  const categories = CATEGORIES.join('|');
  return new RegExp(`^(${categories})(\\.[a-zA-Z0-9_-]+)+$`);
}

/** Pre-built key-format regex (convenience re-export of `getKeyRegex()`). */
export const KEY_REGEX = getKeyRegex();

/**
 * Returns `true` if the given key matches one of the critical-key patterns
 * and therefore cannot be deleted.
 */
export function isCriticalKey(key: string): boolean {
  return CRITICAL_KEY_PATTERNS.some(pattern => pattern.test(key));
}

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

  // Per JSON, usa un limite più alto per mostrare più contenuto
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
    // Aggiungi spazi dopo virgole e due punti per facilitare il wrapping
    return compact.replace(/,/g, ', ').replace(/:/g, ': ').replace(/\s+/g, ' '); // Normalizza spazi multipli
  } catch {
    return jsonString; // Se non è JSON valido, ritorna originale
  }
}

/**
 * Pretty-prints a JSON string with 2-space indentation.
 * Returns the original string on parse error.
 */
export function formatJsonExpanded(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 2); // Con indentazione
  } catch {
    return jsonString; // Se non è JSON valido, ritorna originale
  }
}

/**
 * Returns the Lucide icon name associated with a config category.
 * Falls back to `'Settings'` for unknown categories.
 */
export function getCategoryIcon(category: string): string {
  const iconMap: Record<string, string> = {
    auth: 'Shield',
    app: 'Settings',
    security: 'Lock',
    mail: 'Mail',
    storage: 'HardDrive',
    pricing: 'DollarSign',
    ui: 'Palette',
  };
  return iconMap[category] || 'Settings';
}

/**
 * Returns the Tailwind badge class pair (`bg-*` + `text-*`) for a config category.
 * Falls back to `'bg-gray-100 text-gray-800'` for unknown categories.
 */
export function getCategoryColor(category: string): string {
  const colorMap: Record<string, string> = {
    auth: 'bg-blue-100 text-blue-800',
    app: 'bg-gray-100 text-gray-800',
    security: 'bg-red-100 text-red-800',
    mail: 'bg-green-100 text-green-800',
    storage: 'bg-purple-100 text-purple-800',
    pricing: 'bg-yellow-100 text-yellow-800',
    ui: 'bg-pink-100 text-pink-800',
  };
  return colorMap[category] || 'bg-gray-100 text-gray-800';
}

/**
 * Validates a config key against the expected format (`<category>.<segment>...`).
 * Returns `{ valid: true }` or `{ valid: false, error: string }`.
 */
export function validateConfigKey(key: string): {
  valid: boolean;
  error?: string;
} {
  if (!key.trim()) {
    return { valid: false, error: 'Chiave non può essere vuota' };
  }

  if (!KEY_REGEX.test(key)) {
    return {
      valid: false,
      error: `Formato chiave non valido. Deve iniziare con una categoria supportata (${CATEGORIES.join(', ')})`,
    };
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
