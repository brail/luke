import { getClient } from './client.js';

export interface CalendarMeta {
  id: string;
  summary: string;
}

export async function createCalendar(summary: string, description?: string): Promise<CalendarMeta> {
  const client = getClient();
  const res = await client.calendars.insert({
    requestBody: { summary, description },
  });
  if (!res.data.id) throw new Error('Google Calendar creation returned no id');
  return { id: res.data.id, summary };
}

export async function deleteCalendar(googleCalendarId: string): Promise<void> {
  const client = getClient();
  await client.calendars.delete({ calendarId: googleCalendarId });
}

export function buildCalendarSummary(
  brandCode: string,
  seasonCode: string,
  sectionLabel: string
): string {
  return `Luke • ${brandCode} • ${seasonCode} • ${sectionLabel}`;
}
