/**
 * @luke/core/utils - Input sanitization utilities
 *
 * Functions to validate and safely clean user input
 *
 * @version 0.1.0
 * @author Luke Team
 */

/**
 * Sanitizes a file name by removing dangerous characters
 *
 * Removes:
 * - Path traversal: `..`, `/`, `\`
 * - Control characters (0x00-0x1F)
 * - Filesystem special characters: `<`, `>`, `:`, `"`, `|`, `?`, `*`
 * - Multiple spaces and trailing/leading whitespace
 *
 * @param name - File name to sanitize
 * @returns Safe file name
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

  // Remove path traversal
  sanitized = sanitized.replace(/\.\./g, '');

  // Remove slashes (Unix and Windows)
  sanitized = sanitized.replace(/[/\\]/g, '-');

  // Remove control characters (0x00-0x1F, 0x7F)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Remove filesystem special characters
  sanitized = sanitized.replace(/[<>:"|?*]/g, '-');

  // Reduce multiple spaces to single space
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Remove leading/trailing whitespace
  sanitized = sanitized.trim();

  // Replace remaining spaces with dash
  sanitized = sanitized.replace(/\s/g, '-');

  // If the result is empty or only dashes, use fallback
  if (!sanitized || /^[-]+$/.test(sanitized)) {
    return 'unnamed';
  }

  // Limit length to 255 characters (common filesystem limit)
  if (sanitized.length > 255) {
    // Keep extension if possible
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
 * Validates that a string is a safe path (no traversal)
 *
 * @param pathSegment - Path segment to validate
 * @returns true if the path is safe
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

  // No path traversal
  if (pathSegment.includes('..')) {
    return false;
  }

  // No absolute paths
  if (pathSegment.startsWith('/') || pathSegment.startsWith('\\')) {
    return false;
  }

  // No Windows drive letters
  if (/^[a-zA-Z]:/.test(pathSegment)) {
    return false;
  }

  // No null bytes
  if (pathSegment.includes('\0')) {
    return false;
  }

  return true;
}



