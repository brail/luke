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
 * Fine-grained event keys within the CALENDAR category, one per `notifyCalendarChange` call site
 * in `seasonCalendar.ts`. Lets a user opt out of a specific event type (e.g. reschedules) while
 * keeping the rest of the CALENDAR category enabled — an optional override on top of the
 * coarser per-category toggle, not a replacement for it.
 */
export const CALENDAR_EVENT_KEYS = [
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
export type CalendarEventKey = typeof CALENDAR_EVENT_KEYS[number];
