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

/**
 * Formatta una data con timezone specifico
 *
 * @param date - La data da formattare (Date o string ISO)
 * @param timezone - Il timezone IANA (es: 'Europe/Rome', 'America/New_York')
 * @param options - Opzioni di formattazione Intl.DateTimeFormat
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata della data nel timezone specificato
 *
 * @example
 * ```typescript
 * formatDateWithTimezone(
 *   new Date('2024-01-15T10:30:00Z'),
 *   'Europe/Rome',
 *   { year: 'numeric', month: '2-digit', day: '2-digit' }
 * ) // "15/01/2024"
 * ```
 */
export function formatDateWithTimezone(
  date: Date | string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
  locale: string = 'it-IT'
): string {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    if (!isValidDate(dateObj)) {
      return 'Data non valida';
    }

    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: timezone,
    }).format(dateObj);
  } catch (error) {
    // Fallback se timezone non valido
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(locale, options).format(dateObj);
  }
}

/**
 * Formatta data breve con timezone (es: "15/01/2024")
 *
 * @param date - La data da formattare
 * @param timezone - Il timezone IANA
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata
 */
export function formatShortDate(
  date: Date | string,
  timezone: string,
  locale: string = 'it-IT'
): string {
  return formatDateWithTimezone(
    date,
    timezone,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
    locale
  );
}

/**
 * Formatta data e ora con timezone (es: "15/01/2024, 14:30")
 *
 * @param date - La data da formattare
 * @param timezone - Il timezone IANA
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata
 */
export function formatDateTimeWithTimezone(
  date: Date | string,
  timezone: string,
  locale: string = 'it-IT'
): string {
  return formatDateWithTimezone(
    date,
    timezone,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    },
    locale
  );
}

/**
 * Formatta data compatta (es: "15 gen 2024")
 *
 * @param date - La data da formattare
 * @param timezone - Il timezone IANA
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata
 */
export function formatCompactDate(
  date: Date | string,
  timezone: string,
  locale: string = 'it-IT'
): string {
  return formatDateWithTimezone(
    date,
    timezone,
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    },
    locale
  );
}

/**
 * Formatta solo ora (es: "14:30")
 *
 * @param date - La data da formattare
 * @param timezone - Il timezone IANA
 * @param locale - Il locale per la formattazione (default: 'it-IT')
 * @returns Stringa formattata
 */
export function formatTime(
  date: Date | string,
  timezone: string,
  locale: string = 'it-IT'
): string {
  return formatDateWithTimezone(
    date,
    timezone,
    {
      hour: '2-digit',
      minute: '2-digit',
    },
    locale
  );
}
