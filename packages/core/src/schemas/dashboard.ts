import { z } from 'zod';

/** All registered dashboard widget identifiers. Each ID maps to a rendered widget component. */
export const WIDGET_IDS = [
  'kpi-stats',
  'season-progress',
  'clocks',
  'forex',
  'weekly-sales',
  'tasks',
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

/** Default IANA timezones displayed in the Clocks widget when no user preference is saved. */
export const DEFAULT_CLOCKS_TIMEZONES = ['Europe/Rome', 'Asia/Shanghai', 'America/New_York', 'Europe/London'] as const;
/** Default currency pairs displayed in the Forex widget when no user preference is saved. */
export const DEFAULT_FOREX_PAIRS = ['EUR/CNY', 'EUR/USD', 'EUR/GBP', 'EUR/CHF'] as const;

/** Settings schema for the Clocks dashboard widget — 1 to 6 IANA timezone strings. */
export const ClocksSettingsSchema = z.object({
  timezones: z.array(z.string()).min(1).max(6).default([...DEFAULT_CLOCKS_TIMEZONES]),
});

/** Settings schema for the Forex dashboard widget — 1 to 8 currency pairs in `AAA/BBB` format. */
export const ForexSettingsSchema = z.object({
  pairs: z.array(z.string().regex(/^[A-Z]{3}\/[A-Z]{3}$/)).min(1).max(8).default([...DEFAULT_FOREX_PAIRS]),
});

export type ClocksSettings = z.infer<typeof ClocksSettingsSchema>;
export type ForexSettings = z.infer<typeof ForexSettingsSchema>;

/** Per-widget configuration entry in the user's dashboard layout: position, enabled flag, and widget-specific settings. */
export const WidgetConfigItemSchema = z.object({
  id: z.enum(WIDGET_IDS),
  enabled: z.boolean().default(true),
  position: z.number().int().min(0),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type WidgetConfigItem = z.infer<typeof WidgetConfigItemSchema>;

/** Ordered array of widget configuration items representing a user's full dashboard layout. */
export const DashboardWidgetsSchema = z.array(WidgetConfigItemSchema);

/** Input schema for a personal dashboard task (to-do item with optional due date). */
export const DashboardTaskInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(200),
  done: z.boolean().default(false),
  dueDate: z.string().datetime().optional().nullable(),
});

export type DashboardTaskInput = z.infer<typeof DashboardTaskInputSchema>;
