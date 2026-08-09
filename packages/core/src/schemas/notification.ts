import { z } from 'zod';

/** Allowed categories for a notification, used to group and filter in the UI. */
export const notificationCategoryEnum = z.enum([
  'SYSTEM',
  'CALENDAR',
  'USER_ACTION',
  'WORKFLOW',
]);
export type NotificationCategory = z.infer<typeof notificationCategoryEnum>;

/** Full notification as returned by the API — includes read state and optional deep-link. */
export const notificationSchema = z.object({
  id: z.string(),
  category: notificationCategoryEnum,
  title: z.string(),
  message: z.string(),
  link: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  isRead: z.boolean(),
  readAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Notification = z.infer<typeof notificationSchema>;

/** Sentinel `eventKey` value marking a category-level preference row (as opposed to a specific event-level override). */
export const CATEGORY_LEVEL_EVENT_KEY = '';

/** Per-category (or per-event, when `eventKey` is set) notification preference controlling whether the user receives notifications for that scope. */
export const notificationPreferenceSchema = z.object({
  category: notificationCategoryEnum,
  eventKey: z.string(),
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

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
