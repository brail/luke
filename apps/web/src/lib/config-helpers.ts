/**
 * Helper e utilità per la gestione delle configurazioni
 * Costanti, validazioni e funzioni di supporto per l'interfaccia AppConfig
 */

/**
 * Categorie supportate per le configurazioni
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
 * Regex per chiavi critiche che non possono essere eliminate
 * (deve essere sincronizzato con il backend)
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
 * Genera regex dinamica per validazione formato chiavi
 * (deve essere sincronizzato con il backend)
 */
export function getKeyRegex(): RegExp {
  const categories = CATEGORIES.join('|');
  return new RegExp(`^(${categories})(\\.[a-zA-Z0-9_-]+)+$`);
}

/**
 * Regex per validazione formato chiavi (per compatibilità)
 */
export const KEY_REGEX = getKeyRegex();

/**
 * Verifica se una chiave è critica e non può essere eliminata
 */
export function isCriticalKey(key: string): boolean {
  return CRITICAL_KEY_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Deduce la categoria da una chiave basandosi sul prefix
 */
export function getCategoryFromKey(key: string): string {
  const match = key.match(/^([^.]+)/);
  return match ? match[1] : 'unknown';
}

/**
 * Formatta un valore per la visualizzazione
 * @param value - Valore da formattare
 * @param isEncrypted - Se il valore è cifrato
 * @param truncate - Lunghezza massima prima del troncamento
 * @returns Valore formattato per la visualizzazione
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
  
  return value.length > actualTruncate ? value.slice(0, actualTruncate) + '...' : value;
}

/**
 * Formatta un JSON per la visualizzazione compatta
 * @param jsonString - Stringa JSON da formattare
 * @returns JSON formattato in modo compatto
 */
export function formatJsonCompact(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    return JSON.stringify(parsed, null, 0); // Compatto ma leggibile
  } catch {
    return jsonString; // Se non è JSON valido, ritorna originale
  }
}

/**
 * Formatta un JSON per la visualizzazione espansa
 * @param jsonString - Stringa JSON da formattare
 * @returns JSON formattato con indentazione
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
 * Ottiene l'icona per una categoria
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
 * Ottiene il colore per una categoria
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
 * Valida una chiave di configurazione
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
 * Valida un valore di configurazione
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
 * Genera un nome file per l'export
 */
export function generateExportFileName(): string {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `luke-config-export-${timestamp}.json`;
}

/**
 * Formatta una data per la visualizzazione
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
