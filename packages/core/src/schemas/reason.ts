/**
 * The rationale an operation carries when it is the only record of why it happened.
 */

import { z } from 'zod';

/**
 * A mandatory free-text rationale: trimmed, 1-500 characters.
 *
 * `.trim()` precedes `.min(1)` deliberately. Zod applies string transforms in declaration order, so
 * trimming last measures the untrimmed input and lets a whitespace-only value through as `''` — the
 * form accepts three spaces, the mutation fires, and the server answers in a toast with the message
 * that should have appeared under the field. Reversed, the resolver rejects it where it was typed.
 * (`vendor.ts` still has the no-op ordering.)
 *
 * Shared so the endpoints that demand a reason cannot answer differently for identical input:
 * `collectionLayout.rows.setCompleted` and `seasonCalendar`'s reschedule/cancel inputs.
 */
export const MandatoryReasonSchema = z
  .string()
  .trim()
  .min(1, 'La motivazione è obbligatoria')
  .max(500, 'Massimo 500 caratteri');
