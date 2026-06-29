/**
 * tRPC router for merchandising plan management.
 *
 * Exposes:
 *  - merchandisingPlan.getOrCreate
 *  - merchandisingPlan.updateStatus
 *  - merchandisingPlan.listRows
 *  - merchandisingPlan.createRow / updateRow / deleteRow / reorderRows
 *  - merchandisingPlan.getSpecsheet / upsertSpecsheet
 *  - merchandisingPlan.upsertComponents
 *  - merchandisingPlan.addImage / deleteImage / setDefaultImage
 *  - merchandisingPlan.assignUser
 */

import { z } from 'zod';

import {
  MerchandisingPlanRowInputSchema,
  MerchandisingComponentInputSchema,
  MerchandisingSpecsheetInputSchema,
  MERCHANDISING_PLAN_STATUS,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { createNotification } from '../lib/notifications';
import { withRateLimit } from '../lib/ratelimit';
import { makeUrlResolver } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';

export const merchandisingPlanRouter = router({
  /**
   * Returns the merchandising plan for a brand/season pair, creating one atomically if it does not exist.
   *
   * @auth merchandising_plan:update
   * @input { brandId, seasonId }
   * @output MerchandisingPlan summary (id, status, timestamps)
   */
  getOrCreate: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .input(
      z.object({
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      return ctx.prisma.merchandisingPlan.upsert({
        where: { brandId_seasonId: { brandId: input.brandId, seasonId: input.seasonId } },
        create: { brandId: input.brandId, seasonId: input.seasonId },
        update: {},
        select: { id: true, brandId: true, seasonId: true, status: true, createdAt: true, updatedAt: true },
      });
    }),

  /**
   * Updates the plan status (DRAFT ↔ CONFIRMED).
   *
   * @auth merchandising_plan:update
   * @input { planId, status }
   * @output Updated MerchandisingPlan
   */
  updateStatus: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        planId: z.string().uuid(),
        status: z.enum(MERCHANDISING_PLAN_STATUS),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.prisma.merchandisingPlan.update({
        where: { id: input.planId },
        data: { status: input.status },
      });
      await logAudit(ctx, {
        action: 'MERCHANDISING_PLAN_STATUS_UPDATE',
        targetType: 'MerchandisingPlan',
        targetId: input.planId,
        result: 'SUCCESS',
        metadata: { status: input.status },
      });
      return result;
    }),

  /**
   * Lists all rows for a plan, ordered by `order`, including specsheet summary and default image URL.
   *
   * @auth merchandising_plan:read
   * @input { planId }
   * @output Array of MerchandisingPlanRow with resolved image URLs
   */
  listRows: protectedProcedure
    .use(requirePermission('merchandising_plan:read'))
    .input(z.object({ planId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.prisma.merchandisingPlanRow.findMany({
        where: { planId: input.planId },
        orderBy: { order: 'asc' },
        include: {
          assignedUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          pricingParameterSet: {
            select: { id: true, name: true },
          },
          specsheet: {
            select: {
              id: true,
              supplierName: true,
              _count: { select: { components: true } },
              images: {
                where: { isDefault: true },
                take: 1,
                select: { id: true, key: true },
              },
            },
          },
        },
      });
      const anyKey = rows.some(r => r.specsheet?.images?.[0]?.key);
      const resolve = anyKey ? await makeUrlResolver(ctx.prisma) : null;
      return rows.map(row => ({
        ...row,
        specsheet: row.specsheet ? {
          ...row.specsheet,
          images: row.specsheet.images.map(img => ({
            ...img,
            url: img.key && resolve ? resolve('merchandising-specsheet-images', img.key) : null,
          })),
        } : null,
      }));
    }),

  /**
   * Creates a new row in the merchandising plan.
   *
   * @auth merchandising_plan:update
   * @input MerchandisingPlanRowInputSchema
   * @output The created MerchandisingPlanRow
   */
  createRow: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(MerchandisingPlanRowInputSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.prisma.merchandisingPlanRow.create({
        data: {
          planId: input.planId,
          order: input.order ?? 0,
          articleCode: input.articleCode,
          styleDescription: input.styleDescription,
          styleCode: input.styleCode ?? null,
          colorCode: input.colorCode,
          colorDescription: input.colorDescription,
          gender: input.gender,
          productCategory: input.productCategory,
          lineCode: input.lineCode ?? null,
          lifeType: input.lifeType ?? null,
          carryoverFromSeason: input.carryoverFromSeason ?? null,
          launchType: input.launchType ?? null,
          smsPairsOrder: input.smsPairsOrder ?? null,
          targetPairs: input.targetPairs ?? null,
          cancellationStatus: input.cancellationStatus ?? null,
          designer: input.designer ?? null,
          pricingParameterSetId: input.pricingParameterSetId ?? null,
          targetFobPrice: input.targetFobPrice ?? null,
          firstOfferPrice: input.firstOfferPrice ?? null,
          finalOfferPrice: input.finalOfferPrice ?? null,
          retailTargetIt: input.retailTargetIt ?? null,
          wholesaleIt: input.wholesaleIt ?? null,
          retailTargetEu: input.retailTargetEu ?? null,
          wholesaleEu: input.wholesaleEu ?? null,
          pricingNotes: input.pricingNotes ?? null,
          generalNotes: input.generalNotes ?? null,
          assignedUserId: input.assignedUserId ?? null,
        },
      });
      await logAudit(ctx, {
        action: 'MERCHANDISING_ROW_CREATE',
        targetType: 'MerchandisingPlanRow',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { planId: input.planId },
      });
      return result;
    }),

  /**
   * Partially updates a plan row (patch semantics — only supplied fields are changed).
   *
   * @auth merchandising_plan:update
   * @input { id, data: Partial<MerchandisingPlanRowInput> }
   * @output Updated MerchandisingPlanRow
   */
  updateRow: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: MerchandisingPlanRowInputSchema.omit({ planId: true }).partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.prisma.merchandisingPlanRow.update({
        where: { id: input.id },
        data: input.data,
      });
      await logAudit(ctx, {
        action: 'MERCHANDISING_ROW_UPDATE',
        targetType: 'MerchandisingPlanRow',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });
      return result;
    }),

  /**
   * Deletes a plan row; the specsheet cascades automatically via the DB relation.
   *
   * @auth merchandising_plan:update
   * @input { id }
   * @output { success: true }
   */
  deleteRow: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.merchandisingPlanRow.delete({ where: { id: input.id } });
      await logAudit(ctx, {
        action: 'MERCHANDISING_ROW_DELETE',
        targetType: 'MerchandisingPlanRow',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });
      return { success: true };
    }),

  /**
   * Reorders multiple rows in a single transaction by updating their `order` field.
   *
   * @auth merchandising_plan:update
   * @input { planId, rows: Array<{ id, order }> }
   * @output { success: true }
   */
  reorderRows: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        planId: z.string().uuid(),
        rows: z.array(z.object({ id: z.string().uuid(), order: z.number().int() })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.$transaction(
        input.rows.map(r =>
          ctx.prisma.merchandisingPlanRow.update({
            where: { id: r.id, planId: input.planId },
            data: { order: r.order },
          })
        )
      );
      return { success: true };
    }),

  /**
   * Returns the specsheet for a plan row, including components and images with resolved URLs.
   *
   * @auth merchandising_plan:read
   * @input { rowId }
   * @output MerchandisingSpecsheet with components and images, or null if not yet created
   */
  getSpecsheet: protectedProcedure
    .use(requirePermission('merchandising_plan:read'))
    .input(z.object({ rowId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const specsheet = await ctx.prisma.merchandisingSpecsheet.findUnique({
        where: { rowId: input.rowId },
        include: {
          components: { orderBy: [{ section: 'asc' }, { order: 'asc' }] },
          images: { orderBy: { order: 'asc' } },
        },
      });
      if (!specsheet) return null;
      const resolve = specsheet.images.some(img => img.key) ? await makeUrlResolver(ctx.prisma) : null;
      return {
        ...specsheet,
        images: specsheet.images.map(img => ({
          ...img,
          url: img.key && resolve ? resolve('merchandising-specsheet-images', img.key) : null,
        })),
      };
    }),

  /**
   * Creates or updates the header fields of the specsheet for a plan row.
   *
   * @auth merchandising_plan:update
   * @input { rowId, ...MerchandisingSpecsheetInput }
   * @output The upserted MerchandisingSpecsheet
   */
  upsertSpecsheet: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({ rowId: z.string().uuid() }).merge(MerchandisingSpecsheetInputSchema)
    )
    .mutation(async ({ input, ctx }) => {
      const { rowId, ...data } = input;
      const result = await ctx.prisma.merchandisingSpecsheet.upsert({
        where: { rowId },
        create: { rowId, ...data },
        update: data,
      });
      await logAudit(ctx, {
        action: 'MERCHANDISING_SPECSHEET_UPSERT',
        targetType: 'MerchandisingSpecsheet',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { rowId },
      });
      return result;
    }),

  /**
   * Replaces the entire BOM component list for a specsheet (deleteMany + createMany in a transaction).
   *
   * @auth merchandising_plan:update
   * @input { specsheetId, components: MerchandisingComponentInput[] }
   * @output { success: true }
   */
  upsertComponents: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        specsheetId: z.string().uuid(),
        components: z.array(MerchandisingComponentInputSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.$transaction([
        ctx.prisma.merchandisingComponent.deleteMany({
          where: { specsheetId: input.specsheetId },
        }),
        ctx.prisma.merchandisingComponent.createMany({
          data: input.components.map((c, i) => ({
            specsheetId: input.specsheetId,
            order: c.order ?? i,
            section: c.section,
            partNumber: c.partNumber ?? null,
            component: c.component,
            material: c.material ?? null,
            color: c.color ?? null,
            pantoneNotes: c.pantoneNotes ?? null,
          })),
        }),
      ]);
      await logAudit(ctx, {
        action: 'MERCHANDISING_COMPONENTS_UPSERT',
        targetType: 'MerchandisingSpecsheet',
        targetId: input.specsheetId,
        result: 'SUCCESS',
        metadata: { count: input.components.length },
      });
      return { success: true };
    }),

  /**
   * Adds an image to a specsheet. The first image added is automatically set as default.
   *
   * @auth merchandising_plan:update
   * @input { specsheetId, key, caption? }
   * @output The created MerchandisingImage
   */
  addImage: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        specsheetId: z.string().uuid(),
        key: z.string(),
        caption: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.prisma.$transaction(async tx => {
        const existingCount = await tx.merchandisingImage.count({
          where: { specsheetId: input.specsheetId },
        });
        return tx.merchandisingImage.create({
          data: {
            specsheetId: input.specsheetId,
            key: input.key,
            isDefault: existingCount === 0,
            order: existingCount,
            caption: input.caption ?? null,
          },
        });
      });
      await logAudit(ctx, {
        action: 'MERCHANDISING_IMAGE_ADD',
        targetType: 'MerchandisingSpecsheet',
        targetId: input.specsheetId,
        result: 'SUCCESS',
        metadata: { imageId: result.id },
      });
      return result;
    }),

  /**
   * Deletes an image from a specsheet. If it was the default, the next image (by order) is promoted.
   *
   * @auth merchandising_plan:update
   * @input { id }
   * @output { success: true }
   */
  deleteImage: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const image = await ctx.prisma.merchandisingImage.findUnique({
        where: { id: input.id },
      });
      if (!image) return { success: true };

      await ctx.prisma.$transaction(async tx => {
        await tx.merchandisingImage.delete({ where: { id: input.id } });

        if (image.isDefault) {
          const next = await tx.merchandisingImage.findFirst({
            where: { specsheetId: image.specsheetId },
            orderBy: { order: 'asc' },
          });
          if (next) {
            await tx.merchandisingImage.update({
              where: { id: next.id },
              data: { isDefault: true },
            });
          }
        }
      });

      await logAudit(ctx, {
        action: 'MERCHANDISING_IMAGE_DELETE',
        targetType: 'MerchandisingImage',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { specsheetId: image.specsheetId },
      });
      return { success: true };
    }),

  /**
   * Sets a specific image as the default for its specsheet (resets all others, then sets this one).
   *
   * @auth merchandising_plan:update
   * @input { id }
   * @output { success: true }
   */
  setDefaultImage: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const image = await ctx.prisma.merchandisingImage.findUnique({
        where: { id: input.id },
      });
      if (!image) return { success: true };

      await ctx.prisma.$transaction([
        ctx.prisma.merchandisingImage.updateMany({
          where: { specsheetId: image.specsheetId },
          data: { isDefault: false },
        }),
        ctx.prisma.merchandisingImage.update({
          where: { id: input.id },
          data: { isDefault: true },
        }),
      ]);

      await logAudit(ctx, {
        action: 'MERCHANDISING_IMAGE_SET_DEFAULT',
        targetType: 'MerchandisingImage',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { specsheetId: image.specsheetId },
      });
      return { success: true };
    }),

  /**
   * Assigns (or removes when `userId` is null) a user to a plan row.
   *
   * Sends an in-app notification to the newly assigned user (or the previously assigned user on removal).
   *
   * @auth merchandising_plan:update
   * @input { rowId, userId: string | null }
   * @output Updated MerchandisingPlanRow
   */
  assignUser: protectedProcedure
    .use(requirePermission('merchandising_plan:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        rowId: z.string().uuid(),
        userId: z.string().uuid().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existingRow = await ctx.prisma.merchandisingPlanRow.findUnique({
        where: { id: input.rowId },
        select: { assignedUserId: true, articleCode: true },
      });

      const result = await ctx.prisma.merchandisingPlanRow.update({
        where: { id: input.rowId },
        data: { assignedUserId: input.userId },
      });
      await logAudit(ctx, {
        action: 'MERCHANDISING_ROW_ASSIGN_USER',
        targetType: 'MerchandisingPlanRow',
        targetId: input.rowId,
        result: 'SUCCESS',
        metadata: { userId: input.userId },
      });

      if (input.userId && input.userId !== existingRow?.assignedUserId) {
        await createNotification(ctx.prisma, {
          userId: input.userId,
          category: 'WORKFLOW',
          title: 'Riga assegnata',
          message: `Sei stato assegnato alla riga ${existingRow?.articleCode ?? input.rowId}`,
          link: '/product/merchandising-plan',
          data: { rowId: input.rowId },
        });
      }
      if (!input.userId && existingRow?.assignedUserId) {
        await createNotification(ctx.prisma, {
          userId: existingRow.assignedUserId,
          category: 'WORKFLOW',
          title: 'Riga rimossa',
          message: `Sei stato rimosso dalla riga ${existingRow.articleCode ?? input.rowId}`,
          data: { rowId: input.rowId },
        });
      }

      return result;
    }),
});
