import { getClient } from './client.js';

/**
 * Minimal metadata returned after creating a Google Calendar.
 */
export interface CalendarMeta {
  id: string;
  summary: string;
}

/**
 * Creates a new Google Calendar and returns its id and summary.
 *
 * @throws {Error} When the Google API returns no calendar id.
 */
export async function createCalendar(summary: string, description?: string): Promise<CalendarMeta> {
  const client = getClient();
  const res = await client.calendars.insert({
    requestBody: { summary, description },
  });
  if (!res.data.id) throw new Error('Google Calendar creation returned no id');
  return { id: res.data.id, summary };
}

/**
 * Permanently deletes a Google Calendar.
 */
export async function deleteCalendar(googleCalendarId: string): Promise<void> {
  const client = getClient();
  await client.calendars.delete({ calendarId: googleCalendarId });
}

/**
 * Builds the display name for a Luke Google Calendar.
 *
 * @returns A string in the format `Luke • {brandCode} • {seasonCode} • {sectionLabel}`
 */
export function buildCalendarSummary(
  brandCode: string,
  seasonCode: string,
  sectionLabel: string
): string {
  return `Luke • ${brandCode} • ${seasonCode} • ${sectionLabel}`;
}
