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

/** An issue's address on GitHub, and nowhere else: it becomes a notification's link and goes back to the client. */
const GitHubIssueUrlSchema = z.url({ protocol: /^https$/, hostname: /^github\.com$/ });

/** What `feedback.submit` reads from the issue it created. */
export const GitHubCreatedIssueSchema = z.object({
  number: z.number().int().positive(),
  html_url: GitHubIssueUrlSchema,
});

/** What the feedback sync reads from an issue it follows. */
export const GitHubIssueSchema = z.object({
  state: z.enum(['open', 'closed']),
  comments: z.number().int().nonnegative(),
  html_url: GitHubIssueUrlSchema,
});

/**
 * What the feedback sync reads from one page of an issue's comments. `int()` admits only safe
 * integers, so an id converts to `BigInt` exactly.
 */
export const GitHubIssueCommentPageSchema = z.array(z.object({ id: z.number().int().positive() }));
