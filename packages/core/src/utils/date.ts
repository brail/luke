/**
 * Utility per la gestione delle date
 * Fornisce funzioni per formattazione e parsing delle date
 */

/**
 * Formatta una data secondo le convenzioni locali
 *
 * @param date - La data da formattare
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata della data
 *
 * @example
 * ```typescript
 * formatDate(new Date('2024-01-15')) // "15/01/2024"
 * formatDate(new Date('2024-01-15'), 'en-US') // "1/15/2024"
 * ```
 */
export function formatDate(date: Date, locale: string = 'it-IT'): string {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(date);
  } catch (error) {
    // Fallback a formato ISO se il locale non è valido
    return date.toLocaleDateString('it-IT');
  }
}

/**
 * Converte una stringa in un oggetto Date
 *
 * @param input - Stringa da convertire in data
 * @returns Oggetto Date o null se il parsing fallisce
 *
 * @example
 * ```typescript
 * parseDate('2024-01-15') // Date object
 * parseDate('15/01/2024') // Date object
 * parseDate('invalid') // null
 * ```
 */
export function parseDate(input: string): Date | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  try {
    // Prova prima il parsing diretto
    const date = new Date(input);

    // Verifica che la data sia valida
    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  } catch (error) {
    return null;
  }
}

/**
 * Formatta una data con ora secondo le convenzioni locali
 *
 * @param date - La data da formattare
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata della data con ora
 *
 * @example
 * ```typescript
 * formatDateTime(new Date('2024-01-15T14:30:00')) // "15/01/2024, 14:30"
 * ```
 */
export function formatDateTime(date: Date, locale: string = 'it-IT'): string {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return formatter.format(date);
  } catch (error) {
    // Fallback a formato ISO se il locale non è valido
    return date.toLocaleString('it-IT');
  }
}

/**
 * Verifica se una data è valida
 *
 * @param date - La data da verificare
 * @returns true se la data è valida, false altrimenti
 */
export function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}
