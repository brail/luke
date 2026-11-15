import type { Prisma } from '@luke/db';

/**
 * The users who count as present: active and approved. A user still pending approval cannot sign
 * in. Every set of users chosen by state — who receives a broadcast, who counts, who may be chosen
 * as a recipient — selects through these definitions, so they agree on who counts. A notice about a
 * named person's own account, and a single-account sign-in or recovery lookup, are not such a set.
 * Semgrep rule `luke-user-selection-approved` refuses the filter written inline in a set query.
 */
export const APPROVED_USER_WHERE = { isActive: true, pendingApproval: false } as const satisfies Prisma.UserWhereInput;

/** The administrators who count: active and approved (`APPROVED_USER_WHERE`). */
export const APPROVED_ADMIN_WHERE = { ...APPROVED_USER_WHERE, role: 'admin' } as const satisfies Prisma.UserWhereInput;
