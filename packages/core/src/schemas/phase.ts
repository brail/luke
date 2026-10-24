import { z } from 'zod';

/**
 * The colours a phase badge can take: a fixed palette, never a free value. Each key is drawn with a
 * light and a dark pair that keep the phase name readable, and the name is always written in the
 * badge, so a colour never carries a meaning on its own.
 */
export const PHASE_COLORS = ['gray', 'yellow', 'blue', 'green', 'violet', 'rose', 'teal', 'orange'] as const;
export type PhaseColor = (typeof PHASE_COLORS)[number];

const PhaseColorSchema = z.enum(PHASE_COLORS);

/** Whether a stored value is a palette key; anything else reads as no colour. */
export function isPhaseColor(value: string | null | undefined): value is PhaseColor {
  return PhaseColorSchema.safeParse(value).success;
}

/** Longest phase a catalog entry may declare, in calendar days. */
export const PHASE_DURATION_DAYS_MAX = 365;

/** Longest description a catalog entry may carry. */
export const PHASE_DESCRIPTION_MAX = 500;

/**
 * Unified, ordered production/calendar phase catalog. Replaces the parallel
 * CollectionCatalogItem(type=progress) and CalendarCatalogItem(type=eventType) domains
 * so a row's production state and a calendar event's milestone are comparable on the same axis.
 */
export const PhaseInputBaseSchema = z.object({
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  order: z.number().int().min(0).optional(),
  /** Free text; absent is null, never an empty string. */
  description: z.string().trim().min(1).max(PHASE_DESCRIPTION_MAX).nullable().optional(),
  /** How long the phase takes, in calendar days: added to the furthest phase item's offset to
   * suggest the next one in a milestone template. */
  durationDays: z.number().int().min(1).max(PHASE_DURATION_DAYS_MAX).nullable().optional(),
  color: PhaseColorSchema.nullable().optional(),
});

export const PhaseInputSchema = PhaseInputBaseSchema;
export type PhaseInput = z.infer<typeof PhaseInputSchema>;

/** Formats a Phase (or catalog item) for display: "CODE — Label" when a code is present, else just the label. */
export function formatPhaseLabel(code: string | null | undefined, label: string): string {
  return code ? `${code} — ${label}` : label;
}
