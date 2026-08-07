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
 * Sezioni senza le quali un amministratore non può più riportare in vita
 * l'amministrazione del sistema.
 *
 * `settings` da sola non basta, ed è il buco che la prima versione di questo
 * guard lasciava aperto: la voce di menu Utenti è gated su
 * `settings && settings['settings.users']` (`apps/web/src/hooks/useMenuAccess.ts`),
 * e `settings.users` mappa su `users:read`. Un admin che conserva `settings` ma
 * perde `settings.users` non può più creare né promuovere nessuno — lo stesso
 * lockout, da un'altra porta. Trovato provando a mano su RC.
 *
 * La superficie di recupero è quindi una **congiunzione**: conta come via
 * d'uscita solo chi le ha tutte effettive.
 */
export const ADMIN_RECOVERY_SECTIONS = [
  'settings',
  'settings.users',
] as const satisfies readonly Section[];

/**
 * `true` se togliere questa sezione può chiudere fuori l'amministrazione.
 *
 * Predicato invece di `ADMIN_RECOVERY_SECTIONS.includes(section)` al call site:
 * la tupla è `as const` per conservare i letterali in `every()`, e su una tupla
 * `includes` accetta solo i propri membri — un `Section` qualunque non compila.
 * Il widening sta qui, in un posto solo.
 */
export function isAdminRecoverySection(section: Section): boolean {
  return (ADMIN_RECOVERY_SECTIONS as readonly Section[]).includes(section);
}

type SectionAccessDefaults = Record<
  string,
  Partial<Record<Section, 'auto' | 'enabled' | 'disabled'>>
>;

/** Override di un utente per sezione, nella forma che `effectiveSectionAccess` accetta. */
type OverrideBySection = Map<string, { enabled: boolean }>;

function hasEveryRecoverySection(
  overrides: OverrideBySection,
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: string[]
): boolean {
  return ADMIN_RECOVERY_SECTIONS.every(section =>
    effectiveSectionAccess({
      role: 'admin',
      sectionAccessDefaults,
      userOverride: overrides.get(section) ?? null,
      section,
      disabledSections,
    })
  );
}

/**
 * Counts active admins who can still recover the system under the given
 * `sectionAccessDefaults`/`disabledSections` — same 4-layer evaluation as
 * `effectiveSectionAccess`, not just "has role admin", and across every
 * section in `ADMIN_RECOVERY_SECTIONS`.
 *
 * Pass the currently committed config to check the status quo (used by `set`),
 * or a proposed config to check a hypothetical change before committing it
 * (used by `setRoleDefaults`).
 */
export async function countRecoveryCapableAdmins(
  prisma: PrismaLike,
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: string[]
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: {
      sectionAccess: {
        where: { section: { in: [...ADMIN_RECOVERY_SECTIONS] } },
        select: { section: true, enabled: true },
      },
    },
  });

  return admins.filter(admin =>
    hasEveryRecoverySection(
      new Map(admin.sectionAccess.map(a => [a.section, { enabled: a.enabled }])),
      sectionAccessDefaults,
      disabledSections
    )
  ).length;
}

/**
 * Same evaluation as `countRecoveryCapableAdmins`, but substitutes a
 * hypothetical override for `userId` first — for guarding a specific user's
 * transition, where counting current state and comparing to a threshold breaks
 * for `enabled: null` (removal) and for changes that increase access.
 *
 * @param changedSection - La sezione che sta cambiando, oppure `null` quando
 *   l'utente perde ogni accesso in blocco (demozione, disattivazione,
 *   eliminazione): in quel caso non conta come via d'uscita, qualunque sia il
 *   suo stato per sezione.
 */
export async function countRecoveryCapableAdminsAfterChange(
  prisma: PrismaLike,
  userId: string,
  changedSection: Section | null,
  hypotheticalEnabled: boolean | null,
  sectionAccessDefaults: SectionAccessDefaults,
  disabledSections: string[]
): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: {
      id: true,
      sectionAccess: {
        where: { section: { in: [...ADMIN_RECOVERY_SECTIONS] } },
        select: { section: true, enabled: true },
      },
    },
  });

  return admins.filter(admin => {
    if (admin.id === userId && changedSection === null) return false;

    const overrides: OverrideBySection = new Map(
      admin.sectionAccess.map(a => [a.section, { enabled: a.enabled }])
    );

    if (admin.id === userId && changedSection !== null) {
      if (hypotheticalEnabled === null) {
        overrides.delete(changedSection);
      } else {
        overrides.set(changedSection, { enabled: hypotheticalEnabled });
      }
    }

    return hasEveryRecoverySection(
      overrides,
      sectionAccessDefaults,
      disabledSections
    );
  }).length;
}
