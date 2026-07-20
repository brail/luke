import { getClient } from './client.js';

import type { calendar_v3 } from 'googleapis';


/**
 * Properties required to create or update a Google Calendar event.
 */
export interface EventInput {
  title: string;
  description?: string;
  startAt: Date;
  endAt?: Date;
  allDay: boolean;
  status: 'confirmed' | 'cancelled';
}

function buildEventBody(input: EventInput): calendar_v3.Schema$Event {
  const start: calendar_v3.Schema$EventDateTime = input.allDay
    ? { date: input.startAt.toISOString().slice(0, 10) }
    : { dateTime: input.startAt.toISOString(), timeZone: 'UTC' };

  const end: calendar_v3.Schema$EventDateTime = input.allDay
    ? { date: (input.endAt ?? input.startAt).toISOString().slice(0, 10) }
    : { dateTime: (input.endAt ?? input.startAt).toISOString(), timeZone: 'UTC' };

  return {
    summary: input.title,
    description: input.description,
    start,
    end,
    status: input.status,
  };
}

/**
 * Creates a new event on a Google Calendar.
 *
 * @throws {Error} When the Google API returns no event id
 * @returns The newly created Google event id
 */
export async function createEvent(
  googleCalendarId: string,
  input: EventInput
): Promise<string> {
  const client = getClient();
  const res = await client.events.insert({
    calendarId: googleCalendarId,
    requestBody: buildEventBody(input),
  });
  if (!res.data.id) throw new Error('Google Calendar event creation returned no id');
  return res.data.id;
}

/**
 * Replaces all fields of an existing Google Calendar event with the values in `input`.
 */
export async function updateEvent(
  googleCalendarId: string,
  googleEventId: string,
  input: EventInput
): Promise<void> {
  const client = getClient();
  await client.events.update({
    calendarId: googleCalendarId,
    eventId: googleEventId,
    requestBody: buildEventBody(input),
  });
}

/**
 * Deletes a Google Calendar event.
 * Idempotent: silently succeeds if the event is already gone (410).
 */
export async function deleteEvent(
  googleCalendarId: string,
  googleEventId: string
): Promise<void> {
  const client = getClient();
  try {
    await client.events.delete({ calendarId: googleCalendarId, eventId: googleEventId });
  } catch (err: unknown) {
    // 410 = already deleted — idempotent
    if ((err as { code?: number }).code !== 410) throw err;
  }
}
