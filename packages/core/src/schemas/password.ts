/**
 * The one description of what a password must look like, shared by the server that enforces it and
 * the client that has to tell the user about it.
 *
 * It exists because the two disagreed. The server counts as special only the characters below; the
 * form, the indicators and the reset page all asked for "any non-alphanumeric". A password with
 * `~`, a backtick or a space earned a row of green ticks and a rejection.
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
