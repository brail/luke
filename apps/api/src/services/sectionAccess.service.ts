/**
 * Service layer for section access override management.
 * Handles CRUD and safety checks for UserSectionAccess records.
 */

import { effectiveSectionAccess, sectionEnum, Roles } from '@luke/core';
import type { Section, Role } from '@luke/core';
import { getRbacConfig } from '@luke/core/server';

import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const ALL_SECTIONS = sectionEnum.options;

/**
 * Returns `sectionAccessDefaults`, `disabledSections`, and `computedRoleDefaults`
 * in a single cached call. `computedRoleDefaults` represents effective section access
 * per role without any user-level override (evaluation layers 0 + 2 + 3).
 */
export async function getSectionDefaults(prisma: PrismaClient) {
  const rbacConfig = await getRbacConfig(prisma);
  const { sectionAccessDefaults, disabledSections } = rbacConfig;

  const computedRoleDefaults = Object.fromEntries(
    Roles.map(role => [
      role,
      Object.fromEntries(
        ALL_SECTIONS.map(section => [
          section,
          effectiveSectionAccess({ role, sectionAccessDefaults, userOverride: null, section, disabledSections }),
        ])
      ),
    ])
  ) as Record<Role, Record<Section, boolean>>;

  return { sectionAccessDefaults, disabledSections, computedRoleDefaults };
}

/**
 * Computes effective section access for a user across all four evaluation layers
 * (kill switch → user override → role defaults → RBAC fallback).
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
    ALL_SECTIONS.map(section => {
      const override = overrideMap.get(section);
      return [
        section,
        effectiveSectionAccess({
          role,
          sectionAccessDefaults,
          userOverride: override !== undefined ? { enabled: override } : null,
          section,
          disabledSections,
        }),
      ];
    })
  ) as Record<Section, boolean>;
}

/**
 * Returns the explicit section access override for a specific user and section, or null if none exists.
 */
export async function getOverride(
  prisma: PrismaClient,
  userId: string,
  section: Section
) {
  return prisma.userSectionAccess.findFirst({
    where: {
      userId,
      section,
    },
  });
}

/**
 * Sets or removes the section access override for a user.
 *
 * @param enabled - `true` to allow, `false` to deny, `null` to remove the override entirely.
 * @returns The upserted record, or null when the override was removed.
 */
export async function setOverride(
  prisma: PrismaLike,
  userId: string,
  section: Section,
  enabled: boolean | null,
  logger?: FastifyBaseLogger
) {
  if (enabled === null) {
    // Rimuovi override — un fallimento qui deve propagare: il chiamante
    // (dentro $transaction) deve poter fare rollback invece di committare
    // uno stato che dice "rimosso" e non lo è.
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
 * Counts active admins who have effective access to the `settings` section
 * under the given `sectionAccessDefaults`/`disabledSections` — same 4-layer
 * evaluation as `effectiveSectionAccess`, not just "has role admin". Pass the
 * currently committed config to check the status quo (used by `set`), or a
 * proposed config to check a hypothetical change before committing it (used
 * by `setRoleDefaults`).
 */
export async function countAdminsWithSettingsAccess(
  prisma: PrismaLike,
  sectionAccessDefaults: Record<string, Partial<Record<Section, 'auto' | 'enabled' | 'disabled'>>>,
  disabledSections: string[]
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: {
      sectionAccess: {
        where: { section: 'settings' },
        select: { enabled: true },
      },
    },
  });

  return admins.filter(admin =>
    effectiveSectionAccess({
      role: 'admin',
      sectionAccessDefaults,
      userOverride: admin.sectionAccess[0] ?? null,
      section: 'settings',
      disabledSections,
    })
  ).length;
}

/**
 * Same evaluation as `countAdminsWithSettingsAccess`, but substitutes
 * `userId`'s settings override with a hypothetical value first — for
 * guarding a specific user's transition (set/remove an override), where
 * counting current state and comparing to a threshold breaks for
 * `enabled: null` (removal) and for changes that increase access.
 */
export async function countAdminsWithSettingsAccessAfterChange(
  prisma: PrismaLike,
  userId: string,
  hypotheticalEnabled: boolean | null,
  sectionAccessDefaults: Record<string, Partial<Record<Section, 'auto' | 'enabled' | 'disabled'>>>,
  disabledSections: string[]
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: {
      id: true,
      sectionAccess: { where: { section: 'settings' }, select: { enabled: true } },
    },
  });

  return admins.filter(admin => {
    const enabled =
      admin.id === userId ? hypotheticalEnabled : (admin.sectionAccess[0]?.enabled ?? null);

    return effectiveSectionAccess({
      role: 'admin',
      sectionAccessDefaults,
      userOverride: enabled === null ? null : { enabled },
      section: 'settings',
      disabledSections,
    });
  }).length;
}
