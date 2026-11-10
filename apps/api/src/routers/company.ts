/**
 * tRPC router for company structure management.
 *
 * Exposes three sub-routers:
 *  - company.profile — singleton CompanyProfile CRUD
 *  - company.function — CompanyFunction CRUD, reorder, soft-delete, restore
 *  - company.team — CompanyTeam CRUD, brand scopes, membership management
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  CompanyProfileInputSchema,
  CompanyFunctionInputSchema,
  CompanyFunctionUpdateInputSchema,
  CompanyTeamInputSchema,
  CompanyTeamUpdateInputSchema,
  CompanyTeamMembershipInputSchema,
  CompanyTeamMembershipRemoveInputSchema,
  CompanyTeamMembershipUpdateRoleInputSchema,
} from '@luke/core';
import { Prisma, type PrismaClient } from '@luke/db';

import { logAudit } from '../lib/auditLog.js';
import { runInBackground } from '../lib/backgroundWork.js';
import { isUniqueViolation } from '../lib/error.js';
import { createNotification } from '../lib/notifications.js';
import { confirmPendingFile } from '../lib/pendingFile.js';
import { requirePermission } from '../lib/permissions.js';
import { withRateLimit } from '../lib/ratelimit.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import { deleteObjectByKey } from '../storage';


// ─── Profile ────────────────────────────────────────────────────────────────

const SINGLETON_ID = 'singleton';

const companyProfileRouter = router({
  /**
   * Returns the singleton company profile, auto-creating it with empty values on first access.
   *
   * @auth company_profile:read
   * @output CompanyProfile singleton
   */
  get: protectedProcedure
    .use(requirePermission('company_profile:read'))
    .query(async ({ ctx }) => {
      const existing = await ctx.prisma.companyProfile.findUnique({
        where: { id: SINGLETON_ID },
      });
      if (existing) return existing;
      return ctx.prisma.companyProfile.create({
        data: { id: SINGLETON_ID, legalName: '', displayName: '' },
      });
    }),

  /**
   * Creates or updates the singleton company profile.
   *
   * @auth company_profile:update
   * @input CompanyProfileInputSchema
   * @output Updated CompanyProfile
   */
  update: protectedProcedure
    .use(requirePermission('company_profile:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyProfileInputSchema)
    .mutation(async ({ ctx, input }) => {
      // No `...input` in the upsert: that's how `logoKey` used to pass from the client
      // to the database without anyone checking it.
      const { fileObjectId, logoKey, ...rest } = input;
      const countryCode = (rest.address as { countryCode?: string } | undefined)?.countryCode ?? undefined;

      let oldLogoKey: string | null = null;

      const profile = await ctx.prisma.$transaction(async tx => {
        const existing = await tx.companyProfile.findUnique({
          where: { id: SINGLETON_ID },
          select: { logoKey: true },
        });

        let logoData: { logoKey: string | null } | Record<string, never> = {};

        if (fileObjectId) {
          const confirmedKey = await confirmPendingFile(tx, {
            fileObjectId,
            bucket: 'company-assets',
            userId: ctx.session.user.id,
          });

          // BAD_REQUEST and not a silent no-op: the realistic case isn't a
          // malicious id, it's the reaper. You upload the logo, get distracted for seventy
          // minutes, save — the pending `FileObject` has been swept, the predicate fails,
          // and without this error the profile would save without a logo while showing
          // "Profile updated".
          if (!confirmedKey) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Il file caricato non è più disponibile, ricaricalo',
            });
          }

          logoData = { logoKey: confirmedKey };
          oldLogoKey = existing?.logoKey ?? null;
        } else if (logoKey === null) {
          logoData = { logoKey: null };
          oldLogoKey = existing?.logoKey ?? null;
        }

        return tx.companyProfile.upsert({
          where: { id: SINGLETON_ID },
          create: { id: SINGLETON_ID, ...rest, ...logoData, countryCode: countryCode ?? null },
          update: { ...rest, ...logoData, ...(countryCode !== undefined ? { countryCode } : {}) },
        });
      }, { timeout: 15000 });

      // After the commit, never inside: a rollback would leave the blob deleted.
      // Until now nothing deleted replaced logos, which stayed in
      // `company-assets` forever.
      if (oldLogoKey && oldLogoKey !== profile.logoKey) {
        const staleKey = oldLogoKey;
        runInBackground(async () => {
          try {
            await deleteObjectByKey(ctx, { bucket: 'company-assets', key: staleKey });
          } catch (err) {
            ctx.logger?.warn({ err }, 'Failed to cleanup old company logo');
          }
        });
      }

      await logAudit(ctx, {
        action: 'COMPANY_PROFILE_UPDATED',
        targetType: 'CompanyProfile',
        targetId: SINGLETON_ID,
        result: 'SUCCESS',
        metadata: { logoChanged: Boolean(fileObjectId) || logoKey === null },
      });

      return profile;
    }),
});

// ─── Function ───────────────────────────────────────────────────────────────

/** Partial unique index on the slug of active functions (migration 20260526172738; Prisma cannot model it). */
const FUNCTION_ACTIVE_SLUG_KEY = 'company_functions_slug_active_key';

const slugTaken = (slug: string, advice = '') =>
  new TRPCError({ code: 'CONFLICT', message: `Una funzione attiva con slug "${slug}" esiste già.${advice}` });

/** The active-slug index's refusal of a write that would make a second active function hold `slug`, as CONFLICT (#237). */
const rethrowSlugTaken = (slug: string, advice = '') => (err: unknown): never => {
  if (isUniqueViolation(err, FUNCTION_ACTIVE_SLUG_KEY)) throw slugTaken(slug, advice);
  throw err;
};

const companyFunctionRouter = router({
  /**
   * Lists active company functions ordered by `order` then `name`.
   *
   * @auth company_function:read
   * @input { includeInactive? }
   * @output Array of CompanyFunction with team count
   */
  list: protectedProcedure
    .use(requirePermission('company_function:read'))
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.companyFunction.findMany({
        where: input?.includeInactive ? undefined : { isActive: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { teams: true } },
        },
      });
    }),

  /**
   * Creates a company function, always active (#237). Rejects on slug collision, suggesting restore
   * if the existing one is inactive.
   *
   * @auth company_function:create
   * @input CompanyFunctionInputSchema
   * @output The created CompanyFunction
   */
  create: protectedProcedure
    .use(requirePermission('company_function:create'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyFunctionInputSchema)
    .mutation(async ({ ctx, input }) => {
      // The active row first: when an inactive one shares the slug too, a restore would be refused.
      const existing = await ctx.prisma.companyFunction.findFirst({
        where: { slug: input.slug },
        orderBy: { isActive: 'desc' },
      });
      if (existing) {
        if (!existing.isActive) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Una funzione disattivata con slug "${input.slug}" esiste già. Ripristinala invece di crearne una nuova.`,
          });
        }
        throw slugTaken(input.slug);
      }

      const fn = await ctx.prisma.companyFunction.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          order: input.order ?? 0,
        },
      // A concurrent create of the same slug passes the check above. Every create is active, so the
      // active-slug index refuses the second.
      }).catch(rethrowSlugTaken(input.slug));

      await logAudit(ctx, {
        action: 'COMPANY_FUNCTION_CREATED',
        targetType: 'CompanyFunction',
        targetId: fn.id,
        result: 'SUCCESS',
        metadata: { slug: fn.slug, name: fn.name },
      });

      return fn;
    }),

  /**
   * Updates a company function's name, description and order; `null` clears the description. Its
   * active state is not an update: `delete` and `restore` change it, with their checks (#237). The
   * audit row records before and after of the fields that changed.
   *
   * @auth company_function:update
   * @input CompanyFunctionUpdateInputSchema
   * @output Updated CompanyFunction
   * @throws NOT_FOUND when the function does not exist — also a row removed from the database while
   *   this update waited (no Luke path does that: `delete` only deactivates)
   */
  update: protectedProcedure
    .use(requirePermission('company_function:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyFunctionUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      return ctx.prisma.$transaction(async tx => {
        // Row lock (CLAUDE.md "Raw SQL" exception): the "before" the audit records is what the write
        // replaces, and a row removed meanwhile reads as gone instead of failing the write (P2025).
        await tx.$executeRaw`SELECT 1 FROM company_functions WHERE id = ${id} FOR NO KEY UPDATE`;
        const before = await tx.companyFunction.findUnique({ where: { id } });
        if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Function not found' });

        const fn = await tx.companyFunction.update({ where: { id }, data });
        const changed = (key: 'name' | 'description' | 'order') => before[key] !== fn[key];
        await logAudit(ctx, {
          action: 'COMPANY_FUNCTION_UPDATED',
          targetType: 'CompanyFunction',
          targetId: id,
          result: 'SUCCESS',
          metadata: {
            oldName: changed('name') ? before.name : undefined,
            newName: changed('name') ? fn.name : undefined,
            oldDescription: changed('description') ? before.description : undefined,
            newDescription: changed('description') ? fn.description : undefined,
            oldOrder: changed('order') ? before.order : undefined,
            newOrder: changed('order') ? fn.order : undefined,
          },
        }, { tx });
        return fn;
      }, { timeout: 15000 });
    }),

  /**
   * Updates the `order` field for all listed function IDs in a single transaction.
   *
   * @auth company_function:update
   * @input { orderedIds }
   * @output { ok: true }
   */
  reorder: protectedProcedure
    .use(requirePermission('company_function:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ orderedIds: z.array(z.uuid()) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async tx => {
        await Promise.all(
          input.orderedIds.map((id, index) =>
            tx.companyFunction.update({ where: { id }, data: { order: index } })
          )
        );
      }, { timeout: 15000 });

      await logAudit(ctx, {
        action: 'COMPANY_FUNCTION_REORDERED',
        targetType: 'CompanyFunction',
        result: 'SUCCESS',
        metadata: { orderedIds: input.orderedIds },
      });

      return { ok: true };
    }),

  /**
   * Soft-deletes a company function (sets `isActive = false`).
   *
   * Blocked if the function is visible on active (non-cancelled) calendar events.
   *
   * @auth company_function:delete
   * @input { id }
   * @output The deactivated CompanyFunction
   */
  delete: protectedProcedure
    .use(requirePermission('company_function:delete'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.companyFunction.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Function not found' });

      const fn = await ctx.prisma.$transaction(async tx => {
        const activeMilestones = await tx.calendarEvent.count({
          where: {
            visibilities: { some: { functionId: input.id } },
            cancelledAt: null,
          },
        });
        if (activeMilestones > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Cannot deactivate: ${activeMilestones} active calendar event(s) visible to this function`,
          });
        }
        return tx.companyFunction.update({
          where: { id: input.id },
          data: { isActive: false },
        });
      }, { timeout: 15000 });

      await logAudit(ctx, {
        action: 'COMPANY_FUNCTION_DEACTIVATED',
        targetType: 'CompanyFunction',
        targetId: fn.id,
        result: 'SUCCESS',
      });

      return fn;
    }),

  /**
   * Restores a soft-deleted company function (sets `isActive = true`).
   *
   * Refused with CONFLICT while another active function holds the same slug: the active-slug index
   * refuses the write, a concurrent create or restore included.
   *
   * @auth company_function:update
   * @input { id }
   * @output The restored CompanyFunction
   */
  restore: protectedProcedure
    .use(requirePermission('company_function:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.companyFunction.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Function not found' });
      if (existing.isActive) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Function is already active' });

      // Conditional write (CLAUDE.md rule 3): of two concurrent restores, one finds it active.
      const restored = await ctx.prisma.companyFunction.updateMany({
        where: { id: input.id, isActive: false },
        data: { isActive: true },
      }).catch(rethrowSlugTaken(existing.slug, ' Disattiva quella prima di ripristinare questa.'));
      if (restored.count === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Function is already active' });
      const fn = await ctx.prisma.companyFunction.findUniqueOrThrow({ where: { id: input.id } });

      await logAudit(ctx, {
        action: 'COMPANY_FUNCTION_RESTORED',
        targetType: 'CompanyFunction',
        targetId: fn.id,
        result: 'SUCCESS',
        metadata: { slug: fn.slug, name: fn.name },
      });

      return fn;
    }),
});

// ─── Team ────────────────────────────────────────────────────────────────────

/** Sorted copy: a reordered but equal list compares equal and reads the same in the audit trail. */
const sortedIds = (ids: readonly string[]) => [...new Set(ids)].sort();

/**
 * Locks a team, then its brand scope rows and, with `members`, its memberships (CLAUDE.md "Raw
 * SQL" row-lock exception): what the audit records as "before" (#222) is what the write replaces.
 * Always this order. The team row takes `FOR NO KEY UPDATE`, which serializes team writers without
 * blocking a membership insert's foreign-key check, or `FOR UPDATE` when the team is about to be
 * deleted. The scope rows are locked too because a brand purge deletes them by cascade, without
 * touching the team row.
 */
async function lockTeam(
  tx: Prisma.TransactionClient,
  teamId: string,
  { members = false, deleting = false } = {}
): Promise<void> {
  if (deleting) {
    await tx.$executeRaw`SELECT 1 FROM company_teams WHERE id = ${teamId} FOR UPDATE`;
  } else {
    await tx.$executeRaw`SELECT 1 FROM company_teams WHERE id = ${teamId} FOR NO KEY UPDATE`;
  }
  await tx.$executeRaw`SELECT 1 FROM company_team_brand_scopes WHERE "teamId" = ${teamId} ORDER BY "brandId" FOR UPDATE`;
  if (members) {
    await tx.$executeRaw`SELECT 1 FROM company_team_memberships WHERE "teamId" = ${teamId} ORDER BY "userId" FOR UPDATE`;
  }
}

/**
 * One audit row per member added to or removed from a team, in the write's transaction; an added
 * member's row carries the role they join with.
 */
async function logMembershipAudit(
  ctx: Parameters<typeof logAudit>[0],
  tx: Prisma.TransactionClient,
  action: 'COMPANY_TEAM_MEMBER_ADDED' | 'COMPANY_TEAM_MEMBER_REMOVED',
  teamId: string,
  members: readonly { userId: string; role?: string }[]
): Promise<void> {
  for (const { userId, role } of members) {
    await logAudit(ctx, {
      action,
      targetType: 'CompanyTeamMembership',
      targetId: `${teamId}:${userId}`,
      result: 'SUCCESS',
      metadata: { teamId, userId, role },
    }, { tx });
  }
}

async function fetchTeamName(teamId: string, prisma: PrismaClient): Promise<string> {
  const team = await prisma.companyTeam.findUnique({ where: { id: teamId }, select: { name: true } });
  return team?.name ?? teamId;
}

async function fetchTeam(teamId: string, prisma: PrismaClient) {
  const team = await prisma.companyTeam.findUnique({
    where: { id: teamId },
    select: { name: true, brandScopes: { select: { brand: { select: { name: true } } } } },
  });
  return { name: team?.name ?? teamId, brandNames: team?.brandScopes.map(s => s.brand.name) ?? [] };
}

const companyTeamRouter = router({
  /**
   * Lists company teams for a given function, including membership count and brand scopes.
   *
   * @auth company_team:read
   * @input { functionId, includeInactive? }
   * @output Array of CompanyTeam with membership count and brand scopes
   */
  listByFunction: protectedProcedure
    .use(requirePermission('company_team:read'))
    .input(z.object({ functionId: z.uuid(), includeInactive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.companyTeam.findMany({
        where: {
          functionId: input.functionId,
          ...(input.includeInactive ? {} : { isActive: true }),
        },
        orderBy: [{ name: 'asc' }],
        include: {
          _count: { select: { memberships: true } },
          brandScopes: { include: { brand: { select: { id: true, code: true } } } },
        },
      });
    }),

  /**
   * Returns a company team by ID, including its memberships (with user info) and brand scopes.
   *
   * @auth company_team:read
   * @input { id }
   * @output CompanyTeam with memberships and brand scopes
   */
  getById: protectedProcedure
    .use(requirePermission('company_team:read'))
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.companyTeam.findUnique({
        where: { id: input.id },
        include: {
          memberships: {
            include: { user: { select: { id: true, email: true, username: true } } },
          },
          brandScopes: {
            include: { brand: { select: { id: true, code: true, name: true } } },
          },
        },
      });
      if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      return team;
    }),

  /**
   * Creates a company team and its brand scopes in a single transaction.
   *
   * @auth company_team:create
   * @input CompanyTeamInputSchema
   * @output The created CompanyTeam
   */
  create: protectedProcedure
    .use(requirePermission('company_team:create'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { brandIds, ...teamData } = input;

      // The audit row is written in the transaction: an access change is never saved without it.
      return ctx.prisma.$transaction(async tx => {
        const created = await tx.companyTeam.create({
          data: { ...teamData },
        });
        if (brandIds && brandIds.length > 0) {
          await tx.companyTeamBrandScope.createMany({
            data: brandIds.map(brandId => ({ teamId: created.id, brandId })),
          });
        }
        await logAudit(ctx, {
          action: 'COMPANY_TEAM_CREATED',
          targetType: 'CompanyTeam',
          targetId: created.id,
          result: 'SUCCESS',
          metadata: { name: created.name, functionId: created.functionId, brandIds: sortedIds(brandIds ?? []), isActive: created.isActive },
        }, { tx });
        return created;
      }, { timeout: 15000 });
    }),

  /**
   * Updates a company team's fields and replaces its brand scopes when `brandIds` is provided.
   *
   * @auth company_team:update
   * @input CompanyTeamUpdateInputSchema
   * @output Updated CompanyTeam
   */
  update: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, brandIds, ...data } = input;

      return ctx.prisma.$transaction(async tx => {
        await lockTeam(tx, id);
        const before = await tx.companyTeam.findUnique({
          where: { id },
          select: { isActive: true, brandScopes: { select: { brandId: true } } },
        });
        if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });

        const updated = await tx.companyTeam.update({ where: { id }, data });
        if (brandIds !== undefined) {
          await tx.companyTeamBrandScope.deleteMany({ where: { teamId: id } });
          if (brandIds.length > 0) {
            await tx.companyTeamBrandScope.createMany({
              data: brandIds.map(brandId => ({ teamId: id, brandId })),
            });
          }
        }

        const oldBrandIds = sortedIds(before.brandScopes.map(b => b.brandId));
        const newBrandIds = sortedIds(brandIds ?? []);
        const brandsChanged = brandIds !== undefined && oldBrandIds.join() !== newBrandIds.join();
        const activeChanged = updated.isActive !== before.isActive;
        await logAudit(ctx, {
          action: 'COMPANY_TEAM_UPDATED',
          targetType: 'CompanyTeam',
          targetId: id,
          result: 'SUCCESS',
          metadata: {
            oldBrandIds: brandsChanged ? oldBrandIds : undefined,
            newBrandIds: brandsChanged ? newBrandIds : undefined,
            oldIsActive: activeChanged ? before.isActive : undefined,
            newIsActive: activeChanged ? updated.isActive : undefined,
          },
        }, { tx });
        return updated;
      }, { timeout: 15000 });
    }),

  /**
   * Deletes a company team.
   *
   * @auth company_team:delete
   * @input { id }
   * @output { ok: true }
   */
  delete: protectedProcedure
    .use(requirePermission('company_team:delete'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async tx => {
        // The members the cascade removes are recorded: their access ends here with no row of their own.
        await lockTeam(tx, input.id, { members: true, deleting: true });
        const team = await tx.companyTeam.findUnique({
          where: { id: input.id },
          select: { functionId: true, brandScopes: { select: { brandId: true } }, memberships: { select: { userId: true } } },
        });
        if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });

        await tx.companyTeam.delete({ where: { id: input.id } });
        await logAudit(ctx, {
          action: 'COMPANY_TEAM_DELETED',
          targetType: 'CompanyTeam',
          targetId: input.id,
          result: 'SUCCESS',
          metadata: {
            functionId: team.functionId,
            brandIds: sortedIds(team.brandScopes.map(b => b.brandId)),
            userIds: sortedIds(team.memberships.map(m => m.userId)),
          },
        }, { tx });
      });

      return { ok: true };
    }),

  /**
   * Adds users to a company team and notifies each added member.
   *
   * @auth company_team:update
   * @input CompanyTeamMembershipInputSchema
   * @output { ok: true }
   */
  addMembers: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamMembershipInputSchema)
    .mutation(async ({ ctx, input }) => {
      const team = await fetchTeam(input.teamId, ctx.prisma);

      await ctx.prisma.$transaction(async tx => {
        // Only the memberships actually created are recorded: an existing member or a repeated id
        // is skipped by the insert and gets no grant row.
        const created = await tx.companyTeamMembership.createManyAndReturn({
          data: [...new Set(input.userIds)].map(userId => ({ teamId: input.teamId, userId, role: input.role })),
          skipDuplicates: true,
          select: { userId: true, role: true },
        });
        await logMembershipAudit(ctx, tx, 'COMPANY_TEAM_MEMBER_ADDED', input.teamId, created);
      }, { timeout: 15000 });

      const calendarMsg = team.brandNames.length > 0
        ? `Hai accesso ai calendari di: ${team.brandNames.join(', ')}`
        : 'Hai accesso ai calendari del team';

      await Promise.all(input.userIds.flatMap(userId => [
        createNotification(ctx.prisma, {
          userId,
          category: 'USER_ACTION',
          title: 'Aggiunto al team',
          message: `Sei stato aggiunto al team "${team.name}"`,
          link: '/settings/company',
          data: { teamId: input.teamId },
        }),
        createNotification(ctx.prisma, {
          userId,
          category: 'CALENDAR',
          title: 'Accesso al calendario',
          message: calendarMsg,
          link: '/calendar',
          data: { teamId: input.teamId },
        }),
      ]));

      return { ok: true };
    }),

  /**
   * Removes users from a company team and notifies each removed member.
   *
   * @auth company_team:update
   * @input CompanyTeamMembershipRemoveInputSchema
   * @output { ok: true }
   */
  removeMembers: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamMembershipRemoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamName = await fetchTeamName(input.teamId, ctx.prisma);

      await ctx.prisma.$transaction(async tx => {
        // Only the memberships actually removed are recorded, read under the team's lock.
        await lockTeam(tx, input.teamId, { members: true });
        const removed = await tx.companyTeamMembership.findMany({
          where: { teamId: input.teamId, userId: { in: input.userIds } },
          select: { userId: true },
        });
        await tx.companyTeamMembership.deleteMany({
          where: { teamId: input.teamId, userId: { in: removed.map(m => m.userId) } },
        });
        await logMembershipAudit(ctx, tx, 'COMPANY_TEAM_MEMBER_REMOVED', input.teamId, removed);
      }, { timeout: 15000 });

      await Promise.all(input.userIds.flatMap(userId => [
        createNotification(ctx.prisma, {
          userId,
          category: 'USER_ACTION',
          title: 'Rimosso dal team',
          message: `Sei stato rimosso dal team "${teamName}"`,
          data: { teamId: input.teamId },
        }),
      ]));

      return { ok: true };
    }),

  /**
   * Updates a team member's role and notifies the affected user.
   *
   * @auth company_team:update
   * @input CompanyTeamMembershipUpdateRoleInputSchema
   * @output { ok: true }
   */
  updateMemberRole: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamMembershipUpdateRoleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamName = await fetchTeamName(input.teamId, ctx.prisma);

      await ctx.prisma.$transaction(async tx => {
        // Row lock (CLAUDE.md "Raw SQL" exception): the role recorded as "before" is the one replaced.
        const [membership] = await tx.$queryRaw<{ role: string }[]>(Prisma.sql`
          SELECT role::text AS role FROM company_team_memberships
          WHERE "teamId" = ${input.teamId} AND "userId" = ${input.userId} FOR UPDATE
        `);
        if (!membership) throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });

        await tx.companyTeamMembership.update({
          where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
          data: { role: input.role },
        });
        await logAudit(ctx, {
          action: 'COMPANY_TEAM_MEMBER_ROLE_UPDATED',
          targetType: 'CompanyTeamMembership',
          targetId: `${input.teamId}:${input.userId}`,
          result: 'SUCCESS',
          metadata: { teamId: input.teamId, userId: input.userId, oldRole: membership.role, newRole: input.role },
        }, { tx });
      });

      await createNotification(ctx.prisma, {
        userId: input.userId,
        category: 'USER_ACTION',
        title: 'Ruolo team aggiornato',
        message: `Il tuo ruolo nel team "${teamName}" è ora "${input.role}"`,
        link: '/settings/company',
        data: { teamId: input.teamId, role: input.role },
      });

      return { ok: true };
    }),

  /**
   * Lists all active brands, for use in team brand-scope selection.
   *
   * @auth brands:read
   * @output Array of Brand (id, code, name)
   */
  listAllBrands: protectedProcedure
    .use(requirePermission('brands:read'))
    .query(async ({ ctx }) => {
      return ctx.prisma.brand.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      });
    }),
});

// ─── Export ──────────────────────────────────────────────────────────────────

export const companyRouter = router({
  profile: companyProfileRouter,
  function: companyFunctionRouter,
  team: companyTeamRouter,
});
