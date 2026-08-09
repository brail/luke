/**
 * Utility for date management
 * Provides functions for date formatting and parsing
 */

/**
 * Formats a date according to local conventions
 *
 * @param date - The date to format
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted date string
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
  } catch {
    // Fallback to ISO format if locale is invalid
    return date.toLocaleDateString('it-IT');
  }
}

/**
 * Converts a string to a Date object
 *
 * @param input - String to convert to date
 * @returns Date object or null if parsing fails
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
    // Try direct parsing first
    const date = new Date(input);

    // Verify that the date is valid
    if (isNaN(date.getTime())) {
      return null;
    }

    return date;
  } catch {
    return null;
  }
}

/**
 * Formats a date with time according to local conventions
 *
 * @param date - The date to format
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted date and time string
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
  } catch {
    // Fallback to ISO format if locale is invalid
    return date.toLocaleString('it-IT');
  }
}

/**
 * Checks if a date is valid
 *
 * @param date - The date to check
 * @returns true if the date is valid, false otherwise
 */
export function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Formats a date with a specific timezone
 *
 * @param date - The date to format (Date or ISO string)
 * @param timezone - The IANA timezone (e.g: 'Europe/Rome', 'America/New_York')
 * @param options - Intl.DateTimeFormat formatting options
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted date string in the specified timezone
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
      return 'Invalid date';
    }

    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: timezone,
    }).format(dateObj);
  } catch {
    // Fallback if timezone is invalid
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat(locale, options).format(dateObj);
  }
}

/**
 * Formats short date with timezone (e.g: "15/01/2024")
 *
 * @param date - The date to format
 * @param timezone - The IANA timezone
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted string
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
 * Formats date and time with timezone (e.g: "15/01/2024, 14:30")
 *
 * @param date - The date to format
 * @param timezone - The IANA timezone
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted string
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
 * Formats compact date (e.g: "15 Jan 2024")
 *
 * @param date - The date to format
 * @param timezone - The IANA timezone
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted string
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
 * Formats time only (e.g: "14:30")
 *
 * @param date - The date to format
 * @param timezone - The IANA timezone
 * @param locale - The locale for formatting (default: 'it-IT')
 * @returns Formatted string
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
