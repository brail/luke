import { z } from 'zod';

/**
 * Unified, ordered production/calendar phase catalog. Replaces the parallel
 * CollectionCatalogItem(type=progress) and CalendarCatalogItem(type=eventType) domains
 * so a row's production state and a calendar event's milestone are comparable on the same axis.
 */
export const PhaseInputBaseSchema = z.object({
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  code: z.string().max(10).optional().nullable(),
  order: z.number().int().min(0).optional(),
});

export const PhaseInputSchema = PhaseInputBaseSchema;
export type PhaseInput = z.infer<typeof PhaseInputSchema>;

/** Formats a Phase (or catalog item) for display: "CODE — Label" when a code is present, else just the label. */
export function formatPhaseLabel(code: string | null | undefined, label: string): string {
  return code ? `${code} — ${label}` : label;
}
