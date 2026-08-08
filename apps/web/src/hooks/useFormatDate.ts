'use client';

import { useSession } from 'next-auth/react';

import {
  formatDateWithTimezone,
  formatShortDate,
  formatDateTimeWithTimezone,
  formatCompactDate,
  formatTime,
} from '@luke/core/utils/date';

import { trpc } from '../lib/trpc';

/**
 * Returns date-formatting helpers scoped to the current user's timezone and locale.
 * Fetches up-to-date user preferences from `trpc.me.get` (stale for 5 min) rather
 * than reading them from the NextAuth session, which may lag after a profile update.
 *
 * @returns Object containing formatting functions (`format`, `shortDate`, `dateTime`,
 *   `compactDate`, `time`) plus the resolved `timezone` and `locale` strings.
 *
 * @example
 * ```tsx
 * const fmt = useFormatDate();
 * <p>{fmt.compactDate(user.createdAt)}</p>
 * <p>{fmt.time(user.lastLoginAt)}</p>
 * ```
 */
export function useFormatDate() {
  const { data: session } = useSession();

  // Usa i dati aggiornati dall'API invece della sessione NextAuth
  const { data: userData } = trpc.me.get.useQuery(undefined, {
    enabled: !!session?.accessToken,
    staleTime: 5 * 60 * 1000, // 5 minuti - riduce richieste API
  });

  const timezone = userData?.timezone || 'Europe/Rome';
  const locale = userData?.locale || 'it-IT';

  // Hook per formattazione date con timezone utente

  return {
    /**
     * Formats a date with custom `Intl.DateTimeFormatOptions`.
     * @param options - Intl date/time format options
     */
    format: (date: Date | string, options: Intl.DateTimeFormatOptions) =>
      formatDateWithTimezone(date, timezone, options, locale),

    /**
     * Formats a date as a short numeric string, e.g. "15/01/2024".
     */
    shortDate: (date: Date | string) => formatShortDate(date, timezone, locale),

    /**
     * Formats a date with time, e.g. "15/01/2024, 14:30".
     */
    dateTime: (date: Date | string) =>
      formatDateTimeWithTimezone(date, timezone, locale),

    /**
     * Formats a date in compact form, e.g. "15 gen 2024".
     */
    compactDate: (date: Date | string) =>
      formatCompactDate(date, timezone, locale),

    /**
     * Formats only the time portion, e.g. "14:30".
     */
    time: (date: Date | string) => formatTime(date, timezone, locale),

    /** The current user's resolved timezone (IANA identifier). */
    timezone,

    /** The current user's resolved locale (BCP 47 tag). */
    locale,
  };
}
