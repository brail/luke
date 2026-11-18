/**
 * Service layer for section access override management.
 * Handles CRUD and safety checks for UserSectionAccess records.
 */

import { TRPCError } from '@trpc/server';

import {
  childSectionsOf,
  effectiveSectionAccess,
  refusedRoleDefaults,
  SECTION_TO_PERMISSION,
  sectionEnum,
  sectionPermissionHeld,
} from '@luke/core';
import type { Section, SectionAccessDefaults } from '@luke/core';
import { getRbacConfig } from '@luke/core/server';
import { Prisma, type PrismaClient } from '@luke/db';

import { APPROVED_ADMIN_WHERE } from '../lib/approvedUsers';
import { logAudit, type AuditContext } from '../lib/auditLog';
import { acquireLastAdminLock } from '../lib/lastAdminGuard';

import type { FastifyBaseLogger } from 'fastify';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const ALL_SECTIONS = sectionEnum.options;

/**
 * Returns the per-role section defaults (static table with the AppConfig entries merged over it)
 * and the kill switch, from the cached RBAC configuration. The access dialogs resolve every switch
 * from these with the core's `effectiveSectionAccess`, the resolver the server enforces with.
 */
export async function getSectionDefaults(prisma: PrismaClient) {
  const { sectionAccessDefaults, disabledSections } = await getRbacConfig(prisma);
  return { sectionAccessDefaults, disabledSections };
}

/**
 * Computes effective section access for a user across all four evaluation layers
 * (kill switch → user override → role defaults → RBAC fallback), with parent sections
 * derived from their children (ADR-025).
 *
 * @returns A map of every section to its resolved boolean access value.
 */
export async function computeEffectiveForUser(
  prisma: PrismaClient,
  userId: string,
  role: string
): Promise<Record<Section, boolean>> {
  const [overrides, { sectionAccessDefaults, disabledSections }] = await Promise.all([
    listOverridesForUser(prisma, userId),
    getRbacConfig(prisma),
  ]);

  const overrideMap = new Map(overrides.map(o => [o.section, o.enabled]));

  return Object.fromEntries(
    ALL_SECTIONS.map(section => [
      section,
      effectiveSectionAccess({
        role,
        sectionAccessDefaults,
        userOverrides: overrideMap,
        section,
        disabledSections,
      }),
    ])
  ) as Record<Section, boolean>;
}

/**
 * Sets or removes the section access override for a user — the only writer of `userSectionAccess`.
 * Turning a leaf on needs the permission it maps to (ADR-043); turning it off or removing the
 * override never does. The role is read under a row lock held until commit, so a concurrent role
 * change cannot land between the check and the write. Runs inside the caller's `$transaction`;
 * `applySectionOverride` owns the recovery guard (`ADMIN_RECOVERY_SECTION`) and the audit row.
 *
 * @param enabled - `true` to allow, `false` to deny, `null` to remove the override entirely.
 * @returns The upserted record, or null when the override was removed.
 * @throws {TRPCError} `NOT_FOUND` for no such user, `BAD_REQUEST` naming the missing permission —
 *   both only when turning a leaf on.
 */
export async function setOverride(
  prisma: Prisma.TransactionClient,
  userId: string,
  section: Section,
  enabled: boolean | null,
  logger?: Pick<FastifyBaseLogger, 'error'>
) {
  if (enabled === true) {
    const role = await lockUserRole(prisma, userId);
    if (role === null) throw new TRPCError({ code: 'NOT_FOUND', message: 'Utente non trovato' });
    if (!sectionPermissionHeld(role, section)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: missingSectionPermissionMessage(role, section) });
    }
  }

  if (enabled === null) {
    // Remove override — a failure here must propagate: the caller
    // (inside $transaction) must be able to roll back instead of committing
    // a state that says "removed" when it isn't.
    try {
      await prisma.userSectionAccess.deleteMany({ where: { userId, section } });
    } catch (e) {
      logger?.error({ err: e, userId, section }, 'Failed to delete sectionAccess override');
      throw e;
    }
    return null;
  }

  // Upsert override atomically to avoid DELETE+CREATE race condition
  return prisma.userSectionAccess.upsert({
    where: { userId_section: { userId, section } },
    update: { enabled },
    create: { userId, section, enabled },
  });
}

/**
 * One administrator's override of one section, with every rule around the writer: a parent section
 * takes none (it derives from its children, ADR-027); the recovery section is never taken from the
 * last administrator able to recover the system; `setOverride` checks the permission a leaf needs
 * (ADR-043); the audit row is written in the same transaction. The one path for `sectionAccess.set`
 * and the approval of a pending user (ADR-044). Runs inside the caller's `$transaction`.
 *
 * @throws {TRPCError} `BAD_REQUEST` for a parent section, for the last recovery-capable
 *   administrator, or for a missing permission; `NOT_FOUND` for no such user (turning a leaf on).
 */
export async function applySectionOverride(
  tx: Prisma.TransactionClient,
  ctx: AuditContext,
  userId: string,
  section: Section,
  enabled: boolean | null
) {
  if (childSectionsOf(section).length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `La sezione ${section} dipende dalle sue sottosezioni: abilita o disabilita quelle.`,
    });
  }

  // Removing the recovery section (`ADMIN_RECOVERY_SECTION`, `settings.users`) from the last admin
  // locks them out of user administration — checked only when the target is an admin. The lock is
  // taken before the role is read, like every other point that evaluates this invariant, so it
  // serializes against another holder (another override, `hardDelete`, a demotion,
  // `setRoleDefaults`). A concurrent PROMOTION of the same user does not take it: a narrow, known
  // window remains.
  if (section === ADMIN_RECOVERY_SECTION && enabled !== true) {
    await acquireLastAdminLock(tx);
    const target = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });

    if (target?.role === 'admin') {
      const { sectionAccessDefaults, disabledSections } = await getRbacConfig(tx, { bypassCache: true });
      const survivingAdmins = await countRecoveryCapableAdminsAfterChange(
        tx,
        userId,
        section,
        enabled,
        sectionAccessDefaults,
        disabledSections
      );
      if (survivingAdmins === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            "Questa modifica toglierebbe a tutti gli amministratori l'accesso necessario ad amministrare gli utenti.",
        });
      }
    }
  }

  // Turning a leaf on is checked by the writer itself (ADR-043), under a lock on the role.
  const override = await setOverride(tx, userId, section, enabled, ctx.logger);
  // Keyed by user and section, not by the override row, which a removal deletes (#222).
  // `enabled: null` is a removal.
  await logAudit(ctx, {
    action: 'SECTION_ACCESS_UPDATED',
    targetType: 'UserSectionAccess',
    targetId: `${userId}:${section}`,
    metadata: { targetUserId: userId, section, enabled },
  }, { tx });
  return override;
}

/**
 * Returns all section access overrides for the given user.
 */
export async function listOverridesForUser(
  prisma: PrismaClient,
  userId: string
) {
  return prisma.userSectionAccess.findMany({
    where: { userId },
  });
}

/**
 * The section without which an administrator can no longer bring system
 * administration back to life.
 *
 * `settings.users` is the Users menu entry (`apps/web/src/hooks/useMenuAccess.ts`)
 * and maps to `users:read`: an admin who loses it can no longer create or
 * promote anyone. The first version of this guard looked at `settings` instead
 * and let exactly that through — found by testing by hand on RC. `settings`
 * itself needs no check: it is derived from its children, so an effective
 * `settings.users` already makes it effective, and a kill switch on `settings`
 * turns `settings.users` off with it (ADR-027).
 */
export const ADMIN_RECOVERY_SECTION = 'settings.users' satisfies Section;

/**
 * A user's per-section overrides, in the shape `effectiveSectionAccess` accepts. Only the
 * recovery section's row is loaded: no other row can change whether it is effective.
 */
type OverrideBySection = Map<string, boolean>;

function canRecover(
  overrides: OverrideBySection,
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: readonly Section[]
): boolean {
  return effectiveSectionAccess({
    role: 'admin',
    sectionAccessDefaults,
    userOverrides: overrides,
    section: ADMIN_RECOVERY_SECTION,
    disabledSections,
  });
}

/** An active admin and their override on the recovery section, if any. */
export interface AdminRecoveryOverrides {
  id: string;
  overrides: OverrideBySection;
}

/**
 * The one read every recovery count works from: active, approved admins with their override on the
 * recovery section. A caller that counts twice (before and after a change) loads once, so both
 * counts see the same rows.
 */
export async function loadAdminRecoveryOverrides(
  prisma: PrismaLike
): Promise<AdminRecoveryOverrides[]> {
  const admins = await prisma.user.findMany({
    where: APPROVED_ADMIN_WHERE,
    select: {
      id: true,
      sectionAccess: {
        where: { section: ADMIN_RECOVERY_SECTION },
        select: { section: true, enabled: true },
      },
    },
  });
  return admins.map(admin => ({
    id: admin.id,
    overrides: new Map(admin.sectionAccess.map(a => [a.section, a.enabled])),
  }));
}

/**
 * How many of `admins` can still recover the system under the given
 * `sectionAccessDefaults`/`disabledSections` — same 4-layer evaluation as
 * `effectiveSectionAccess`, not just "has role admin", on
 * `ADMIN_RECOVERY_SECTION`.
 */
export function countRecoveryCapable(
  admins: readonly AdminRecoveryOverrides[],
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: readonly Section[]
): number {
  return admins.filter(admin =>
    canRecover(admin.overrides, sectionAccessDefaults, disabledSections)
  ).length;
}

/**
 * Counts active admins who can still recover the system: `countRecoveryCapable` over a fresh
 * `loadAdminRecoveryOverrides`.
 *
 * Pass the currently committed config to check the status quo (used by `set`),
 * or a proposed config to check a hypothetical change before committing it
 * (used by `setRoleDefaults`).
 */
export async function countRecoveryCapableAdmins(
  prisma: PrismaLike,
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: readonly Section[]
): Promise<number> {
  return countRecoveryCapable(
    await loadAdminRecoveryOverrides(prisma),
    sectionAccessDefaults,
    disabledSections
  );
}

/**
 * Same evaluation as `countRecoveryCapableAdmins`, but substitutes a
 * hypothetical override for `userId` first — for guarding a specific user's
 * transition, where counting current state and comparing to a threshold breaks
 * for `enabled: null` (removal) and for changes that increase access.
 *
 * @param changedSection - The section being changed, or `null` when the user
 *   loses all access at once (demotion, deactivation, deletion): in that case
 *   it doesn't count as a way out, whatever its per-section status is.
 */
export async function countRecoveryCapableAdminsAfterChange(
  prisma: PrismaLike,
  userId: string,
  changedSection: Section | null,
  hypotheticalEnabled: boolean | null,
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: readonly Section[]
): Promise<number> {
  // The admins as they would be after the change: `userId` gone, or carrying the
  // hypothetical override; everyone else as loaded.
  const after = (await loadAdminRecoveryOverrides(prisma)).flatMap(admin => {
    if (admin.id !== userId) return [admin];
    if (changedSection === null) return [];
    const overrides: OverrideBySection = new Map(admin.overrides);
    if (hypotheticalEnabled === null) {
      overrides.delete(changedSection);
    } else {
      overrides.set(changedSection, hypotheticalEnabled);
    }
    return [{ ...admin, overrides }];
  });

  return countRecoveryCapable(after, sectionAccessDefaults, disabledSections);
}

/**
 * The role of `userId`, read under a row lock held until the transaction commits, or `null` for no
 * such user. A write that turns a section on checks this role (ADR-043); `FOR SHARE` keeps it the
 * user's until commit, so a concurrent role change waits instead of slipping in after the check.
 * Compatible with the key-share lock the override upsert's foreign-key check takes.
 */
async function lockUserRole(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
  // FOR SHARE, which the ORM cannot express (CLAUDE.md, "Raw SQL": a row lock inside an interactive
  // transaction, to keep a checked row unchanged until commit).
  const [row] = await tx.$queryRaw<{ role: string }[]>(Prisma.sql`
    SELECT role FROM users WHERE id = ${userId} FOR SHARE
  `);
  return row?.role ?? null;
}

/** The refusal text for turning `section` on for `role`, which lacks its mapped permission. */
export function missingSectionPermissionMessage(role: string, section: Section): string {
  return `La sezione ${section} richiede il permesso ${SECTION_TO_PERMISSION[section]}, che il ruolo ${role} non ha.`;
}

/** A stored override or role default that turns on a section its role cannot read. */
type SectionAccessViolation =
  | { kind: 'user'; userId: string; role: string; section: Section }
  | { kind: 'role'; role: string; section: Section };

/**
 * Every stored violation of ADR-043: per-user overrides turned on, and stored role defaults set to
 * `enabled`, on a leaf the role lacks the permission for. Reported, never changed: such data
 * predates the rule, or a later role change, a restore or a script brought it in.
 */
export async function findSectionAccessViolations(prisma: PrismaClient): Promise<SectionAccessViolation[]> {
  const [overrides, { sectionAccessDefaults }] = await Promise.all([
    prisma.userSectionAccess.findMany({
      where: { enabled: true },
      select: { userId: true, section: true, user: { select: { role: true } } },
    }),
    getRbacConfig(prisma, { bypassCache: true }),
  ]);
  const userViolations = overrides.flatMap(({ userId, section, user }) => {
    const parsed = sectionEnum.safeParse(section);
    if (!parsed.success || sectionPermissionHeld(user.role, parsed.data)) return [];
    return [{ kind: 'user' as const, userId, role: user.role, section: parsed.data }];
  });
  const roleViolations = refusedRoleDefaults(sectionAccessDefaults).map(v => ({ kind: 'role' as const, ...v }));
  return [...userViolations, ...roleViolations];
}

/**
 * Logs every stored violation once at start-up (#262): one warning each, with ids and section keys
 * only. A failure is logged and does not stop the server.
 */
export async function warnSectionAccessViolations(prisma: PrismaClient, logger: FastifyBaseLogger): Promise<void> {
  try {
    for (const violation of await findSectionAccessViolations(prisma)) {
      logger.warn(
        { ...violation, permission: SECTION_TO_PERMISSION[violation.section] },
        'Section access turns on a section without its permission'
      );
    }
  } catch (err) {
    logger.error({ err }, 'Section access violation check failed');
  }
}
