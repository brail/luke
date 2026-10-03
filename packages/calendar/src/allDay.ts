/**
 * The day after an all-day event's last day, at UTC midnight. Luke's `endAt` is the last day of the
 * event, while an all-day end is exclusive both in iCalendar (`DTEND;VALUE=DATE`) and in Google's
 * `end.date`: sending the last day as is showed every multi-day event one day short.
 */
export function dayAfter(lastDay: Date): Date {
  return new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate() + 1));
}
