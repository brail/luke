import { z } from 'zod';

export const WIDGET_IDS = [
  'kpi-stats',
  'season-progress',
  'clocks',
  'forex',
  'weekly-sales',
  'tasks',
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export const DEFAULT_CLOCKS_TIMEZONES = ['Europe/Rome', 'Asia/Shanghai', 'America/New_York', 'Europe/London'] as const;
export const DEFAULT_FOREX_PAIRS = ['EUR/CNY', 'EUR/USD', 'EUR/GBP', 'EUR/CHF'] as const;

export const ClocksSettingsSchema = z.object({
  timezones: z.array(z.string()).min(1).max(6).default([...DEFAULT_CLOCKS_TIMEZONES]),
});

export const ForexSettingsSchema = z.object({
  pairs: z.array(z.string().regex(/^[A-Z]{3}\/[A-Z]{3}$/)).min(1).max(8).default([...DEFAULT_FOREX_PAIRS]),
});

export type ClocksSettings = z.infer<typeof ClocksSettingsSchema>;
export type ForexSettings = z.infer<typeof ForexSettingsSchema>;

export const WidgetConfigItemSchema = z.object({
  id: z.enum(WIDGET_IDS),
  enabled: z.boolean().default(true),
  position: z.number().int().min(0),
  settings: z.record(z.unknown()).optional(),
});

export type WidgetConfigItem = z.infer<typeof WidgetConfigItemSchema>;

export const DashboardWidgetsSchema = z.array(WidgetConfigItemSchema);

export const DashboardTaskInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(200),
  done: z.boolean().default(false),
  dueDate: z.string().datetime().optional().nullable(),
});

export type DashboardTaskInput = z.infer<typeof DashboardTaskInputSchema>;
