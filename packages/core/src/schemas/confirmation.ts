/**
 * Typed-confirmation fields: an irreversible operation carries back a phrase its dialog made a
 * human type.
 */

import { z } from 'zod';

/**
 * Builds the confirmation field for an irreversible operation.
 *
 * What it guarantees, and what it does not — the two are easy to conflate, and earlier wording in
 * this codebase got it wrong:
 *
 * - It does **not** prove a human typed anything. The phrase is a public constant and the client
 *   sends it either way; no server-side check can tell those apart.
 * - It **does** mean the endpoint refuses a call that carries only an id, the way `--force` does on
 *   a CLI. That is what stands between the operation and a request built by hand, a script, or a
 *   client wired wrong.
 *
 * The friction itself belongs to the dialog, which keeps its confirm button disabled until the
 * typed phrase matches.
 *
 * A refined string rather than `z.literal`: the literal type leaks into every form and caller that
 * touches the field and forces hand-written narrowing, while the runtime check is identical.
 */
export function typedConfirmation(phrase: string) {
  return z.string().refine(value => value === phrase, {
    message: `Devi digitare esattamente "${phrase}" per confermare`,
  });
}

/** Phrase gating the permanent deletion of a brand, season, vendor or user. */
export const HARD_DELETE_CONFIRM_PHRASE = 'ELIMINA';

/** The confirmation field every hard-delete input carries. See {@link typedConfirmation}. */
export const HardDeleteConfirmSchema = z.object({
  confirmPhrase: typedConfirmation(HARD_DELETE_CONFIRM_PHRASE),
});
