'use client';

import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { DEFAULT_LOCALE, formatInstant, NUMERIC_DATE_TIME, NUMERIC_TIME } from '@luke/core';

import { trpc } from '../lib/trpc';

/** Shown while the zone is unknown. */
const PENDING = '…';

/**
 * Formats instants in the reader zone — the profile zone as `me.get` resolves it — and in the one
 * locale dates are written in until the i18n cycle (`DEFAULT_LOCALE`). Until `me.get` has answered
 * (`ready` false) the formatters return a placeholder; if it fails, `error` is set, one toast says
 * so, and the placeholder stays: no other zone stands in (ADR-035).
 *
 * @example
 * ```tsx
 * const fmt = useFormatDate();
 * <p>{fmt.dateTime(user.createdAt)}</p>
 * ```
 */
export function useFormatDate() {
  const { data: session } = useSession();
  const { data, error } = trpc.me.get.useQuery(undefined, {
    // The request carries the session's token, so it waits for the session.
    enabled: !!session?.accessToken,
    staleTime: 5 * 60 * 1000,
  });
  const zone = data?.timezone;
  const failed = !zone && !!error;

  useEffect(() => {
    // One toast however many components format dates: sonner replaces a toast with the same id.
    if (failed) toast.error('Fuso orario del profilo non disponibile: date non mostrate', { id: 'reader-zone' });
  }, [failed]);

  const format = (value: Date | string, options: Intl.DateTimeFormatOptions) =>
    zone ? formatInstant(new Date(value), zone, options, DEFAULT_LOCALE) : PENDING;

  return {
    /** Whether the reader zone is known. */
    ready: !!zone,
    /** The `me.get` error, when the zone could not be loaded. */
    error,
    /** The reader zone (IANA), once known. */
    zone,
    /** The locale every date is written in. */
    locale: DEFAULT_LOCALE,
    format,
    /** Date and wall time, e.g. "15/01/2024, 14:30". */
    dateTime: (value: Date | string) => format(value, NUMERIC_DATE_TIME),
    /** Wall time only, e.g. "14:30". */
    time: (value: Date | string) => format(value, NUMERIC_TIME),
  };
}
