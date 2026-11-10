import { addCalendarDays, calendarDateOf } from '@luke/core';

import { getClient } from './client.js';
import { googleErrorStatus } from './retry.js';

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

/** Google's exclusive `end.date` for an all-day event's last day (see `dayAfter`). */
export function exclusiveEndDate(lastDay: Date): string {
  return addCalendarDays(calendarDateOf(lastDay), 1);
}

function buildEventBody(input: EventInput): calendar_v3.Schema$Event {
  const start: calendar_v3.Schema$EventDateTime = input.allDay
    ? { date: calendarDateOf(input.startAt) }
    : { dateTime: input.startAt.toISOString(), timeZone: 'UTC' };

  const end: calendar_v3.Schema$EventDateTime = input.allDay
    ? { date: exclusiveEndDate(input.endAt ?? input.startAt) }
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
 * Whether `err`, from a call on one event, means the event is gone from Google (deleted by hand,
 * for example): a 410, or a 404 while its calendar still answers. Google also answers 404 for a
 * calendar the caller can no longer reach (another identity owns it); the event may then still be
 * there, visible to that calendar's readers, so the answer is `false`. Any other failure of the
 * calendar check is thrown, so `withRetry` can retry it.
 */
export async function isEventGone(googleCalendarId: string, err: unknown): Promise<boolean> {
  const status = googleErrorStatus(err);
  if (status === 410) return true;
  if (status !== 404) return false;
  try {
    await getClient().calendars.get({ calendarId: googleCalendarId });
    return true;
  } catch (checkErr: unknown) {
    if (googleErrorStatus(checkErr) === 404) return false;
    throw checkErr;
  }
}

/**
 * Deletes a Google Calendar event.
 * Idempotent: silently succeeds if the event is already gone (`isEventGone`). An event in a
 * calendar the caller can no longer reach is reported as not deleted, instead of being dropped
 * from Luke while it stays visible on Google.
 */
export async function deleteEvent(
  googleCalendarId: string,
  googleEventId: string
): Promise<void> {
  try {
    await getClient().events.delete({ calendarId: googleCalendarId, eventId: googleEventId });
  } catch (err: unknown) {
    if (!(await isEventGone(googleCalendarId, err))) throw err;
  }
}
