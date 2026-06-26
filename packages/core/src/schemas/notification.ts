import { z } from 'zod';

export const notificationCategoryEnum = z.enum([
  'SYSTEM',
  'CALENDAR',
  'USER_ACTION',
  'WORKFLOW',
]);
export type NotificationCategory = z.infer<typeof notificationCategoryEnum>;

export const notificationSchema = z.object({
  id: z.string(),
  category: notificationCategoryEnum,
  title: z.string(),
  message: z.string(),
  link: z.string().nullable(),
  data: z.record(z.unknown()).nullable(),
  isRead: z.boolean(),
  readAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationPreferenceSchema = z.object({
  category: notificationCategoryEnum,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;
