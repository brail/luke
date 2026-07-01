/**
 * Returns "Nome C." when firstName and lastName are available, falling back to username.
 * Suitable for notification messages and audit log actor labels.
 */
export function abbreviatedName(user: {
  firstName?: string | null;
  lastName?: string | null;
  username: string;
}): string {
  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  if (first && last) return `${first} ${last.charAt(0).toUpperCase()}.`;
  if (first) return first;
  return user.username;
}

/**
 * Returns "Nome Cognome" when both are available, falling back to username.
 * Use when full name display is required (e.g. email digest, in-app notifications).
 */
export function fullName(user: {
  firstName?: string | null;
  lastName?: string | null;
  username: string;
}): string {
  const first = user.firstName?.trim();
  const last = user.lastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  return user.username;
}
