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
 * Hook per formattare date con timezone dell'utente corrente
 * Utilizza i dati aggiornati dall'API tRPC invece della sessione NextAuth
 *
 * @returns Oggetto con funzioni di formattazione date e info timezone/locale
 *
 * @example
 * ```tsx
 * const formatDate = useFormatDate();
 *
 * <p>{formatDate.compactDate(user.createdAt)}</p>
 * <p>{formatDate.time(user.lastLoginAt)}</p>
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
     * Formattazione custom con opzioni Intl personalizzate
     * @param date - Data da formattare
     * @param options - Opzioni Intl.DateTimeFormatOptions
     */
    format: (date: Date | string, options: Intl.DateTimeFormatOptions) =>
      formatDateWithTimezone(date, timezone, options, locale),

    /**
     * Formatta data breve: "15/01/2024"
     * @param date - Data da formattare
     */
    shortDate: (date: Date | string) => formatShortDate(date, timezone, locale),

    /**
     * Formatta data e ora: "15/01/2024, 14:30"
     * @param date - Data da formattare
     */
    dateTime: (date: Date | string) =>
      formatDateTimeWithTimezone(date, timezone, locale),

    /**
     * Formatta compatta: "15 gen 2024"
     * @param date - Data da formattare
     */
    compactDate: (date: Date | string) =>
      formatCompactDate(date, timezone, locale),

    /**
     * Formatta solo ora: "14:30"
     * @param date - Data da formattare
     */
    time: (date: Date | string) => formatTime(date, timezone, locale),

    /** Timezone corrente dell'utente */
    timezone,

    /** Locale corrente dell'utente */
    locale,
  };
}
