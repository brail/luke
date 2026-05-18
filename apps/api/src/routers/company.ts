import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
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
  hasPermission,
  type Role,
} from '@luke/core';

import { logAudit } from '../lib/auditLog.js';
import { createNotification } from '../lib/notifications.js';
import { withRateLimit } from '../lib/ratelimit.js';
import { requirePermission } from '../lib/permissions.js';
import { router, protectedProcedure } from '../lib/trpc.js';

// ─── Profile ────────────────────────────────────────────────────────────────

const SINGLETON_ID = 'singleton';

const companyProfileRouter = router({
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

  update: protectedProcedure
    .use(requirePermission('company_profile:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyProfileInputSchema)
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.prisma.companyProfile.upsert({
        where: { id: SINGLETON_ID },
        create: { id: SINGLETON_ID, ...input },
        update: input,
      });

      await logAudit(ctx, {
        action: 'COMPANY_PROFILE_UPDATED',
        targetType: 'CompanyProfile',
        targetId: SINGLETON_ID,
        result: 'SUCCESS',
      });

      return profile;
    }),
});

// ─── Function ───────────────────────────────────────────────────────────────

const companyFunctionRouter = router({
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

  getById: protectedProcedure
    .use(requirePermission('company_function:read'))
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const fn = await ctx.prisma.companyFunction.findUnique({
        where: { id: input.id },
        include: {
          teams: {
            include: {
              _count: { select: { memberships: true } },
            },
            orderBy: [{ name: 'asc' }],
          },
        },
      });
      if (!fn) throw new TRPCError({ code: 'NOT_FOUND', message: 'Function not found' });
      return fn;
    }),

  create: protectedProcedure
    .use(requirePermission('company_function:create'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyFunctionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const fn = await ctx.prisma.companyFunction.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          order: input.order ?? 0,
          isActive: input.isActive ?? true,
        },
      });

      await logAudit(ctx, {
        action: 'COMPANY_FUNCTION_CREATED',
        targetType: 'CompanyFunction',
        targetId: fn.id,
        result: 'SUCCESS',
        metadata: { slug: fn.slug, name: fn.name },
      });

      return fn;
    }),

  update: protectedProcedure
    .use(requirePermission('company_function:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyFunctionUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const existing = await ctx.prisma.companyFunction.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Function not found' });

      const fn = await ctx.prisma.companyFunction.update({ where: { id }, data });

      await logAudit(ctx, {
        action: 'COMPANY_FUNCTION_UPDATED',
        targetType: 'CompanyFunction',
        targetId: fn.id,
        result: 'SUCCESS',
      });

      return fn;
    }),

  reorder: protectedProcedure
    .use(requirePermission('company_function:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
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

  delete: protectedProcedure
    .use(requirePermission('company_function:delete'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.companyFunction.findUnique({
        where: { id: input.id },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Function not found' });

      const fn = await ctx.prisma.$transaction(async tx => {
        const activeMilestones = await tx.calendarMilestone.count({
          where: {
            ownerFunctionId: input.id,
            status: { not: 'CANCELLED' },
          },
        });
        if (activeMilestones > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Cannot deactivate: ${activeMilestones} active milestone(s) owned by this function`,
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
});

// ─── Team ────────────────────────────────────────────────────────────────────

async function fetchTeamName(teamId: string, prisma: PrismaClient): Promise<string> {
  const team = await prisma.companyTeam.findUnique({ where: { id: teamId }, select: { name: true } });
  return team?.name ?? teamId;
}

const companyTeamRouter = router({
  listByFunction: protectedProcedure
    .use(requirePermission('company_team:read'))
    .input(z.object({ functionId: z.string().uuid(), includeInactive: z.boolean().optional() }))
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

  getById: protectedProcedure
    .use(requirePermission('company_team:read'))
    .input(z.object({ id: z.string().uuid() }))
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

  create: protectedProcedure
    .use(requirePermission('company_team:create'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { brandIds, ...teamData } = input;

      const team = await ctx.prisma.$transaction(async tx => {
        const created = await tx.companyTeam.create({
          data: { ...teamData },
        });
        if (brandIds && brandIds.length > 0) {
          await tx.companyTeamBrandScope.createMany({
            data: brandIds.map(brandId => ({ teamId: created.id, brandId })),
          });
        }
        return created;
      }, { timeout: 15000 });

      await logAudit(ctx, {
        action: 'COMPANY_TEAM_CREATED',
        targetType: 'CompanyTeam',
        targetId: team.id,
        result: 'SUCCESS',
        metadata: { name: team.name, functionId: team.functionId },
      });

      return team;
    }),

  update: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, brandIds, ...data } = input;

      const existing = await ctx.prisma.companyTeam.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });

      const team = await ctx.prisma.$transaction(async tx => {
        const updated = await tx.companyTeam.update({ where: { id }, data });
        if (brandIds !== undefined) {
          await tx.companyTeamBrandScope.deleteMany({ where: { teamId: id } });
          if (brandIds.length > 0) {
            await tx.companyTeamBrandScope.createMany({
              data: brandIds.map(brandId => ({ teamId: id, brandId })),
            });
          }
        }
        return updated;
      }, { timeout: 15000 });

      await logAudit(ctx, {
        action: 'COMPANY_TEAM_UPDATED',
        targetType: 'CompanyTeam',
        targetId: team.id,
        result: 'SUCCESS',
      });

      return team;
    }),

  delete: protectedProcedure
    .use(requirePermission('company_team:delete'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.companyTeam.delete({ where: { id: input.id } }).catch((e: unknown) => {
        if ((e as { code?: string })?.code === 'P2025') throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
        throw e;
      });

      await logAudit(ctx, {
        action: 'COMPANY_TEAM_DELETED',
        targetType: 'CompanyTeam',
        targetId: input.id,
        result: 'SUCCESS',
      });

      return { ok: true };
    }),

  addMembers: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamMembershipInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamName = await fetchTeamName(input.teamId, ctx.prisma);

      await ctx.prisma.companyTeamMembership.createMany({
        data: input.userIds.map(userId => ({ teamId: input.teamId, userId, role: input.role })),
        skipDuplicates: true,
      });

      await Promise.all(input.userIds.flatMap(userId => [
        logAudit(ctx, {
          action: 'COMPANY_TEAM_MEMBER_ADDED',
          targetType: 'CompanyTeamMembership',
          targetId: `${input.teamId}:${userId}`,
          result: 'SUCCESS',
          metadata: { teamId: input.teamId, userId },
        }),
        createNotification(ctx.prisma, {
          userId,
          category: 'USER_ACTION',
          title: 'Aggiunto al team',
          message: `Sei stato aggiunto al team "${teamName}"`,
          link: '/settings/company',
          data: { teamId: input.teamId },
        }),
      ]));

      return { ok: true };
    }),

  removeMembers: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamMembershipRemoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamName = await fetchTeamName(input.teamId, ctx.prisma);

      await ctx.prisma.companyTeamMembership.deleteMany({
        where: { teamId: input.teamId, userId: { in: input.userIds } },
      });

      await Promise.all(input.userIds.flatMap(userId => [
        logAudit(ctx, {
          action: 'COMPANY_TEAM_MEMBER_REMOVED',
          targetType: 'CompanyTeamMembership',
          targetId: `${input.teamId}:${userId}`,
          result: 'SUCCESS',
          metadata: { teamId: input.teamId, userId },
        }),
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

  updateMemberRole: protectedProcedure
    .use(requirePermission('company_team:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CompanyTeamMembershipUpdateRoleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamName = await fetchTeamName(input.teamId, ctx.prisma);

      await ctx.prisma.companyTeamMembership
        .update({
          where: { teamId_userId: { teamId: input.teamId, userId: input.userId } },
          data: { role: input.role },
        })
        .catch((e: unknown) => {
          if ((e as { code?: string })?.code === 'P2025') throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
          throw e;
        });

      await logAudit(ctx, {
        action: 'COMPANY_TEAM_MEMBER_ROLE_UPDATED',
        targetType: 'CompanyTeamMembership',
        targetId: `${input.teamId}:${input.userId}`,
        result: 'SUCCESS',
        metadata: { teamId: input.teamId, userId: input.userId, role: input.role },
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

  listAllBrands: protectedProcedure
    .use(requirePermission('company_team:update'))
    .query(async ({ ctx }) => {
      return ctx.prisma.brand.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      });
    }),
});

// ─── Milestone user visibility ───────────────────────────────────────────────

async function assertFunctionMemberOrAdmin(
  ctx: { session: { user: { id: string; role: string } }; prisma: import('@prisma/client').PrismaClient },
  functionId: string
) {
  if (hasPermission({ role: ctx.session.user.role as Role }, 'company_function:update')) return;
  const membership = await ctx.prisma.companyTeamMembership.findFirst({
    where: { userId: ctx.session.user.id, team: { functionId, isActive: true } },
  });
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of the owning function' });
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const companyRouter = router({
  profile: companyProfileRouter,
  function: companyFunctionRouter,
  team: companyTeamRouter,
});

export { assertFunctionMemberOrAdmin };
