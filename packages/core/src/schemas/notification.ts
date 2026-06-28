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

/** Per-category notification preference controlling whether the user receives notifications for that category. */
export const notificationPreferenceSchema = z.object({
  category: notificationCategoryEnum,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;
