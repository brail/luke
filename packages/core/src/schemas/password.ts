import { z } from 'zod';

/**
 * The one description of what a password must look like, shared by the server that enforces it and
 * the client that has to tell the user about it.
 *
 * It exists because the two disagreed. The server counts as special only the characters below,
 * while the form schema, the indicator hook and `ChangePasswordSchema` all asked for "any
 * non-alphanumeric" — so a password with `~`, a backtick or a space earned a row of green ticks and
 * a rejection. (The reset page is a separate case: it asked for no complexity at all.)
 */

/**
 * Characters that satisfy the "special character" requirement.
 *
 * An explicit allowlist rather than "not a letter or a digit": it is the set the server has always
 * enforced, and widening it silently at the moment the policy became authoritative would have
 * relaxed the reset path for every existing installation. Listed as a string so a UI can show the
 * user exactly which characters count, instead of the word "symbol".
 */
export const PASSWORD_SPECIAL_CHARS = '!@#$%^&*()_+-=[]{};\':"\\|,.<>/?';

/**
 * Matches a password containing at least one character from {@link PASSWORD_SPECIAL_CHARS}.
 *
 * Built from the constant so the two cannot drift; the escapes cover the characters that carry
 * meaning inside a character class.
 */
export const PASSWORD_SPECIAL_CHAR_REGEX = new RegExp(
  `[${PASSWORD_SPECIAL_CHARS.replace(/[\\\]^-]/g, '\\$&')}]`
);

/**
 * The static check every password input applies before the configured policy runs.
 *
 * Deliberately not the policy: complexity and the real minimum live in AppConfig and are applied
 * server-side by `validatePassword`, because a schema compiled into the bundle cannot know what an
 * installation configured. What stays here is only what is true regardless — 8 is the floor
 * `AppConfigRegistry` refuses to go below, and 128 caps what gets handed to argon2.
 *
 * These schemas used to carry `min(12)` and, in one of the three, four complexity regexes. That was
 * the divergence: raising the configured minimum left them accepting the old one, and relaxing a
 * configured requirement left them refusing anyway.
 */
export const passwordPrefilterSchema = z
  .string()
  .min(8, 'Password deve essere di almeno 8 caratteri')
  .max(128, 'Password troppo lunga');
