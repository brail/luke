import { z } from 'zod';

/** Allowed categories for a notification, used to group and filter in the UI. */
export const notificationCategoryEnum = z.enum([
  'SYSTEM',
  'CALENDAR',
  'USER_ACTION',
  'WORKFLOW',
]);
export type NotificationCategory = z.infer<typeof notificationCategoryEnum>;

/** Sentinel `eventKey` value marking a category-level preference row (as opposed to a specific event-level override). */
export const CATEGORY_LEVEL_EVENT_KEY = '';

/**
 * Fine-grained event keys within the CALENDAR category: a user can opt out of one type (e.g.
 * reschedules) and keep the rest of the category. A key can only mute: the per-category toggle stays
 * the master switch. Three kinds, kept apart so each sender takes only its own:
 * change notices (one per `notifyCalendarChange` call site in `seasonCalendar.ts`), deadline notices
 * (the deadline scheduler) and the daily email digest.
 */
export const CALENDAR_CHANGE_KEYS = [
  'CALENDAR_CREATE',
  'CALENDAR_UPDATE',
  'CALENDAR_RESCHEDULE',
  'CALENDAR_DELETE',
  'CALENDAR_BULK_DELETE',
  'CALENDAR_CANCEL',
  'CALENDAR_UNCANCEL',
  'CALENDAR_APPLY_TEMPLATE',
  'CALENDAR_CLONE',
] as const;
export type CalendarChangeKey = typeof CALENDAR_CHANGE_KEYS[number];

/** Deadline notices: an event coming due, an event overdue, collection rows late on a phase. */
export const CALENDAR_DEADLINE_KEYS = ['CALENDAR_DEADLINE_UPCOMING', 'CALENDAR_DEADLINE_OVERDUE', 'CALENDAR_PHASE_OVERDUE'] as const;

/** The daily calendar email digest. */
export const CALENDAR_DIGEST_KEY = 'CALENDAR_DIGEST';

/** Every CALENDAR event key a preference can be stored for. */
export const CALENDAR_EVENT_KEYS = [...CALENDAR_CHANGE_KEYS, ...CALENDAR_DEADLINE_KEYS, CALENDAR_DIGEST_KEY] as const;
export type CalendarEventKey = typeof CALENDAR_EVENT_KEYS[number];
