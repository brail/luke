import type { Prisma } from '@luke/db';

/**
 * The users who count as present: active and approved. A user still pending approval cannot sign
 * in. The last-admin guard, in-app notifications, calendar audiences and the system actor of
 * automatic revisions select users through these definitions, so they agree on who counts.
 */
export const APPROVED_USER_WHERE = { isActive: true, pendingApproval: false } as const satisfies Prisma.UserWhereInput;

/** The administrators who count: active and approved (`APPROVED_USER_WHERE`). */
export const APPROVED_ADMIN_WHERE = { ...APPROVED_USER_WHERE, role: 'admin' } as const satisfies Prisma.UserWhereInput;
