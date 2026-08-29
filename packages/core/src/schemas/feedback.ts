import { z } from 'zod';

/**
 * User-submitted feedback, opened as a GitHub issue by `feedback.submit`.
 *
 * The type drives the issue's labels server-side, so the two values are a contract with the
 * router's LABEL_MAP rather than free-form UI copy.
 */
export const FeedbackTypeSchema = z.enum(['bug', 'feature']);
export type FeedbackType = z.infer<typeof FeedbackTypeSchema>;

/** Input schema for submitting a bug report or feature request. */
export const FeedbackSubmitInputSchema = z.object({
  type: FeedbackTypeSchema,
  title: z.string().min(1, 'Il titolo è obbligatorio').max(200),
  description: z.string().min(1, 'La descrizione è obbligatoria').max(4000),
});
export type FeedbackSubmitInput = z.infer<typeof FeedbackSubmitInputSchema>;
