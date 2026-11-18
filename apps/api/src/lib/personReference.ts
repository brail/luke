import type { Prisma } from '@luke/db';

/**
 * A person named in a record another user reads — a team member, an assignee, a share candidate:
 * the id, the username and the display name, nothing else. The account's other fields are read
 * through the users procedures.
 */
export const PERSON_REFERENCE_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
} as const satisfies Prisma.UserSelect;
