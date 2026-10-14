'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { calendarDateIn, DEFAULT_LOCALE, formatInstant, isValidTimeZone, NUMERIC_DATE, NUMERIC_DATE_TIME, NUMERIC_TIME } from '@luke/core';

import { formatRelativeTime, PENDING } from '../lib/relativeTime';
import { trpc } from '../lib/trpc';

/** An instant, as a `Date` or its ISO string — never a `CalendarDate`, which `formatCalendarDate` writes without a zone. */
type Instant = Date | (string & { readonly __brand?: never });

/** The browser's zone, or UTC when it reports one `Intl` cannot use; a value read in it names it. */
function browserZone(): string {
  // eslint-disable-next-line @luke/no-implicit-zone-date -- a reader without a session has no profile zone; every value read in this one names it (ADR-035)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(zone) ? zone : 'UTC';
}

/**
 * Formats instants in the reader zone — the profile zone as `me.get` resolves it — and in the one
 * locale dates are written in until the i18n cycle (`DEFAULT_LOCALE`). Until `me.get` has answered
 * (`ready` false) the formatters return a placeholder; if it fails, `error` is set, one toast says
 * so, and the placeholder stays: no other zone stands in (ADR-035). A reader without a session (the
 * sign-in page) has no profile zone: the browser zone dates instants, and every absolute value
 * names it (a relative one does not).
 *
 * @example
 * ```tsx
 * const fmt = useFormatDate();
 * <p>{fmt.dateTime(user.createdAt)}</p>
 * ```
 */
export function useFormatDate() {
  const { data: session, status } = useSession();
  const { data, error } = trpc.me.get.useQuery(undefined, {
    // The request carries the session's token, so it waits for the session.
    enabled: !!session?.accessToken,
    staleTime: 5 * 60 * 1000,
  });
  const sessionless = status === 'unauthenticated';
  const profileZone = data?.timezone;
  // A zone this browser's `Intl` does not know (older zone data than the server's) is unavailable,
  // like a failed read: formatting with it would throw during render.
  const zone = sessionless ? browserZone() : profileZone && isValidTimeZone(profileZone) ? profileZone : undefined;
  const failed = !zone && (!!error || !!profileZone);

  useEffect(() => {
    // One toast however many components format dates: sonner replaces a toast with the same id.
    if (failed) toast.error('Fuso orario del profilo non disponibile: date non mostrate', { id: 'reader-zone' });
  }, [failed]);

  const format = (value: Instant, options: Intl.DateTimeFormatOptions) => {
    if (!zone) return PENDING;
    const text = formatInstant(new Date(value), zone, options, DEFAULT_LOCALE);
    return sessionless ? `${text} (${zone})` : text;
  };

  return {
    /** Whether the reader zone is known. */
    ready: !!zone,
    /** The `me.get` error, when the zone could not be loaded. */
    error,
    /** The reader zone (IANA), once known. */
    zone,
    /** Today in the reader zone, once it is known. */
    today: zone ? calendarDateIn(new Date(), zone) : undefined,
    /** The locale every date is written in. */
    locale: DEFAULT_LOCALE,
    /** The instant's day, e.g. "15/01/2024". */
    date: (value: Instant) => format(value, NUMERIC_DATE),
    /** Date and wall time, e.g. "15/01/2024, 14:30". */
    dateTime: (value: Instant) => format(value, NUMERIC_DATE_TIME),
    /** Wall time only, e.g. "14:30". */
    time: (value: Instant) => format(value, NUMERIC_TIME),
    /** Relative to now, days counted in the reader zone, e.g. "5 minuti fa", "ieri" (`formatRelativeTime`). */
    relative: (value: Instant, options?: { ahead?: boolean }) => formatRelativeTime(value, zone, options),
  };
}

/**
 * The reader zone as the calling form first knew it, `undefined` until then. A form names it next
 * to its time fields and converts typed wall times with it, so a profile change while the form is
 * open does not reinterpret what was typed (ADR-035). It is captured once per mount: a dialog calls
 * it from a body mounted only while the dialog is open.
 */
export function useFormZone(): string | undefined {
  const { zone } = useFormatDate();
  const [captured, setCaptured] = useState(zone);
  // Set once, during render: React's pattern for state that depends on an earlier render (React
  // discards this render's output and renders again with the state set).
  if (captured === undefined && zone !== undefined) setCaptured(zone);
  return captured;
}
