import { z } from 'zod';

import { CalendarDateSchema, TimeZoneSchema } from './dates.js';

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

/** A currency pair as the Forex widget and its rates query take it: `AAA/BBB`. */
export const FOREX_PAIR_PATTERN = /^[A-Z]{3}\/[A-Z]{3}$/;

/** Settings schema for the Clocks dashboard widget — 1 to 6 IANA zones, in the spelling `Intl` gives them. */
export const ClocksSettingsSchema = z.object({
  timezones: z.array(TimeZoneSchema).min(1, 'Almeno un fuso orario').max(6).default([...DEFAULT_CLOCKS_TIMEZONES]),
});

/** Settings schema for the Forex dashboard widget — 1 to 8 currency pairs in `AAA/BBB` format. */
export const ForexSettingsSchema = z.object({
  pairs: z
    .array(z.string().regex(FOREX_PAIR_PATTERN, 'Coppia di valute non valida (AAA/BBB)'))
    .min(1, 'Almeno una coppia di valute')
    .max(8)
    .default([...DEFAULT_FOREX_PAIRS]),
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

/** A widget entry as it is saved: the settings of the clocks and forex widgets pass their own schema. */
const WidgetSaveSchema = z.discriminatedUnion('id', [
  WidgetConfigItemSchema.extend({ id: z.literal('clocks'), settings: ClocksSettingsSchema.optional() }),
  WidgetConfigItemSchema.extend({ id: z.literal('forex'), settings: ForexSettingsSchema.optional() }),
  WidgetConfigItemSchema.extend({ id: z.enum(WIDGET_IDS).exclude(['clocks', 'forex']) }),
]);

/**
 * The layout as `dashboard.saveConfig` accepts it: a clock zone or a forex pair the widget cannot
 * render is refused on save.
 */
export const DashboardWidgetsSaveSchema = z.array(WidgetSaveSchema);

/**
 * Ordered array of widget configuration items representing a user's full dashboard layout, as it
 * is read back. A widget's settings its own schema refuses (stored before it was checked on save)
 * are dropped, so the widget shows its defaults and the next save, which sends the whole layout,
 * is accepted.
 */
export const DashboardWidgetsSchema = z.array(
  WidgetConfigItemSchema.transform(item => {
    const checked = WidgetSaveSchema.safeParse(item);
    return checked.success ? checked.data : { ...item, settings: undefined };
  }),
);

/**
 * Input schema for a personal dashboard task (to-do item with optional due date). The due date is a
 * calendar day. On an update a field left out keeps its stored value, and a `null` due date clears
 * it.
 */
export const DashboardTaskInputSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(200),
  done: z.boolean().optional(),
  dueDate: CalendarDateSchema.optional().nullable(),
});

export type DashboardTaskInput = z.infer<typeof DashboardTaskInputSchema>;

/**
 * The answer of Frankfurter (`https://api.frankfurter.app/{latest|YYYY-MM-DD}?from=…&to=…`), the ECB
 * reference rates behind the exchange-rate widget: the fixing's ECB working day and its rates. An
 * external source, so its day is checked as a calendar day where it is read (ADR-035 §Bounds).
 */
export const FrankfurterRatesSchema = z.object({
  date: CalendarDateSchema,
  rates: z.record(z.string(), z.number()),
});
