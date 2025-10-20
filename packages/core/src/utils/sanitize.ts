/**
 * @luke/core/utils - Utility per sanitizzazione input
 *
 * Funzioni per validare e ripulire input utente in modo sicuro
 *
 * @version 0.1.0
 * @author Luke Team
 */

/**
 * Sanitizza un nome file rimuovendo caratteri pericolosi
 *
 * Rimuove:
 * - Path traversal: `..`, `/`, `\`
 * - Control characters (0x00-0x1F)
 * - Caratteri speciali filesystem: `<`, `>`, `:`, `"`, `|`, `?`, `*`
 * - Spazi multipli e trailing/leading whitespace
 *
 * @param name - Nome file da sanitizzare
 * @returns Nome file sicuro
 *
 * @example
 * sanitizeFileName("../../etc/passwd") // "etc-passwd"
 * sanitizeFileName("file<test>.txt") // "file-test-.txt"
 * sanitizeFileName("  multi   spaces  .pdf") // "multi-spaces.pdf"
 */
export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'unnamed';
  }

  let sanitized = name;

  // Rimuovi path traversal
  sanitized = sanitized.replace(/\.\./g, '');

  // Rimuovi slash (Unix e Windows)
  sanitized = sanitized.replace(/[/\\]/g, '-');

  // Rimuovi control characters (0x00-0x1F, 0x7F)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Rimuovi caratteri speciali filesystem
  sanitized = sanitized.replace(/[<>:"|?*]/g, '-');

  // Riduce spazi multipli a singolo spazio
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Rimuovi whitespace leading/trailing
  sanitized = sanitized.trim();

  // Sostituisci spazi rimanenti con dash
  sanitized = sanitized.replace(/\s/g, '-');

  // Se il risultato è vuoto o solo dash, usa fallback
  if (!sanitized || /^[-]+$/.test(sanitized)) {
    return 'unnamed';
  }

  // Limita lunghezza a 255 caratteri (limite filesystem comune)
  if (sanitized.length > 255) {
    // Mantieni estensione se possibile
    const lastDot = sanitized.lastIndexOf('.');
    if (lastDot > 0 && lastDot > sanitized.length - 10) {
      const ext = sanitized.slice(lastDot);
      const basename = sanitized.slice(0, 255 - ext.length);
      sanitized = basename + ext;
    } else {
      sanitized = sanitized.slice(0, 255);
    }
  }

  return sanitized;
}

/**
 * Valida che una stringa sia un path safe (niente traversal)
 *
 * @param pathSegment - Segmento di path da validare
 * @returns true se il path è sicuro
 *
 * @example
 * isPathSafe("uploads/2025/10/file.pdf") // true
 * isPathSafe("../etc/passwd") // false
 * isPathSafe("/absolute/path") // false
 */
export function isPathSafe(pathSegment: string): boolean {
  if (!pathSegment || typeof pathSegment !== 'string') {
    return false;
  }

  // Niente path traversal
  if (pathSegment.includes('..')) {
    return false;
  }

  // Niente absolute paths
  if (pathSegment.startsWith('/') || pathSegment.startsWith('\\')) {
    return false;
  }

  // Niente Windows drive letters
  if (/^[a-zA-Z]:/.test(pathSegment)) {
    return false;
  }

  // Niente null bytes
  if (pathSegment.includes('\0')) {
    return false;
  }

  return true;
}


