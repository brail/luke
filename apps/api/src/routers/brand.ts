/**
 * tRPC router for Brand management
 * Implements full CRUD for Brand with audit logging
 */

import { TRPCError } from '@trpc/server';


import {
  BrandInputSchema,
  BrandHardDeleteInputSchema,
  BrandIdSchema,
  BrandListInputSchema,
  PurgeInputSchema,
  BrandUpdateInputSchema,
  normalizeCode,
  type Role,
} from '@luke/core';
import type { Prisma } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { isUniqueViolation } from '../lib/error';
import { confirmPendingFile } from '../lib/pendingFile';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { makeUrlResolver } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import { assertUnreferenced, deleteUnreferenced, previewPurge, purge } from '../services/catalogDelete.service';
import { getUserAllowedBrandIds } from '../services/context.service.js';
import { deleteObjectByKey } from '../storage';


const BRAND_SELECT = {
  id: true,
  code: true,
  name: true,
  logoKey: true,
  navBrandId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function buildWhereClause(filters: { isActive?: boolean; search?: string }): Prisma.BrandWhereInput {
  const where: Prisma.BrandWhereInput = {};

  if (typeof filters.isActive === 'boolean') {
    where.isActive = filters.isActive;
  }

  if (filters.search && filters.search.trim()) {
    where.OR = [
      { code: { contains: filters.search, mode: 'insensitive' } },
      { name: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export const brandRouter = router({
  /**
   * Lists brands with optional filters and cursor-based pagination, scoped to the user's allowed brands.
   *
   * @auth {brands:read}
   * @input {BrandListInputSchema} — optional cursor, limit, isActive filter, search string.
   * @output {{ items: Brand[], nextCursor: string | null, hasMore: boolean }} — paginated brand list with resolved logoUrl.
   */
  list: protectedProcedure
    .use(requirePermission('brands:read'))
    .input(BrandListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 50;

      const where = buildWhereClause(input || {});
      const allowedBrandIds = await getUserAllowedBrandIds(ctx.session.user.id, ctx.prisma, ctx.session.user.role as Role);
      if (allowedBrandIds !== null) {
        where.id = { in: allowedBrandIds };
      }

      const items = await ctx.prisma.brand.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: BRAND_SELECT,
      });

      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? results[results.length - 1].id : null;

      const resolve = results.some(b => b.logoKey) ? await makeUrlResolver(ctx.prisma) : null;
      const withUrls = results.map(b => ({
        ...b,
        logoUrl: b.logoKey && resolve ? resolve('brand-logos', b.logoKey) : null,
      }));
      return { items: withUrls, nextCursor, hasMore: !!nextCursor };
    }),

  /**
   * Creates a new brand, optionally linking a pending logo file object in the same transaction.
   *
   * @auth {brands:create}
   * @input {BrandInputSchema} — code, name, navBrandId (optional), fileObjectId for logo (optional).
   * @output {Brand} — the created brand with resolved logoUrl.
   */
  create: protectedProcedure
    .use(requirePermission('brands:create'))
    .use(withRateLimit('brandMutations'))
    .input(BrandInputSchema)
    .mutation(async ({ input, ctx }) => {
      const normalizedCode = normalizeCode(input.code);
      const { fileObjectId, ...brandData } = input;

      const created = await ctx.prisma.$transaction(async tx => {
        const existingBrand = await tx.brand.findUnique({
          where: { code: normalizedCode },
        });

        if (existingBrand) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Codice brand già esistente',
          });
        }

        // Validates navBrandId uniqueness if provided — inside the transaction to avoid TOCTOU
        if (brandData.navBrandId) {
          const conflict = await tx.brand.findUnique({
            where: { navBrandId: brandData.navBrandId },
          });
          if (conflict) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice NAV già collegato a un altro brand',
            });
          }
        }

        const brand = await tx.brand.create({
          data: { ...brandData, code: normalizedCode },
          select: BRAND_SELECT,
        });

        // Confirms pending logo and links it to the brand atomically.
        // findUnique (not findFirst) since id is the PK — findFirst is unnecessary overhead.
        if (fileObjectId) {
          const confirmedKey = await confirmPendingFile(tx, {
            fileObjectId,
            bucket: 'brand-logos',
            userId: ctx.session!.user.id,
          });
          // A dead id is an error, not a no-op. The realistic trigger isn't a
          // malicious id: it's the pending-file reaper that swept up the file
          // while the user was distracted. Without this, the brand saves without
          // a logo and the UI says "created" — data loss with a success toast.
          if (!confirmedKey) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Il file caricato non è più disponibile, ricaricalo',
            });
          }

          return tx.brand.update({
            where: { id: brand.id },
            data: { logoKey: confirmedKey },
            select: BRAND_SELECT,
          });
        }

        return brand;
      }, { timeout: 15000 })
        // The check-then-act above is inside a transaction, but PostgreSQL runs in
        // READ COMMITTED: two concurrent creates with the same code or NAV link don't
        // see each other and both reach the insert. The unique constraint prevents the
        // duplicate — but without this translation the loser would get a raw
        // Prisma error (500) instead of the CONFLICT it gets via the explicit
        // check when it loses the race. Same pattern as the P2025 in company.ts.
        .catch((e: unknown) => {
          if (isUniqueViolation(e, 'brands_code_key')) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice brand già esistente',
            });
          }
          if (isUniqueViolation(e, 'brands_navBrandId_key')) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Codice NAV già collegato a un altro brand',
            });
          }
          throw e;
        });

      let finalLogoUrl: string | null = null;
      if (created.logoKey) {
        const resolve = await makeUrlResolver(ctx.prisma);
        finalLogoUrl = resolve('brand-logos', created.logoKey);
      }

      await logAudit(ctx, { action: 'BRAND_CREATE', targetType: 'Brand', targetId: created.id, result: 'SUCCESS', metadata: { name: created.name, code: created.code } });
      return { ...created, logoUrl: finalLogoUrl };
    }),

  /**
   * Updates an existing brand's fields; blocks NAV-link change if already set.
   *
   * @auth {brands:update}
   * @input {BrandUpdateInputSchema} — id, partial brand fields, optional fileObjectId for new logo.
   * @output {Brand} — the updated brand with resolved logoUrl.
   */
  update: protectedProcedure
    .use(requirePermission('brands:update'))
    .use(withRateLimit('brandMutations'))
    .input(BrandUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      let oldLogoKey: string | null = null;

      const result = await ctx.prisma.$transaction(async tx => {
        const existingBrand = await tx.brand.findUnique({
          where: { id: input.id },
        });

        if (!existingBrand) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
        }

        if (input.data.code && input.data.code !== existingBrand.code) {
          const normalizedCode = normalizeCode(input.data.code);
          const conflictingBrand = await tx.brand.findFirst({
            where: { code: normalizedCode, id: { not: input.id } },
          });

          if (conflictingBrand) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Codice brand già esistente' });
          }

          input.data.code = normalizedCode;
        }

        // Validates navBrandId uniqueness if changed
        if (input.data.navBrandId !== undefined && input.data.navBrandId !== existingBrand.navBrandId) {
          // Blocks any change to the NAV link if already set — use the unlink endpoint
          if (existingBrand.navBrandId !== null) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Il collegamento NAV non può essere modificato. Usa "Scollega da NAV" per rimuoverlo.',
            });
          }
          if (input.data.navBrandId) {
            const conflict = await tx.brand.findFirst({
              where: { navBrandId: input.data.navBrandId, id: { not: input.id } },
            });
            if (conflict) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'Codice NAV già collegato a un altro brand',
              });
            }
          }
        }

        const { fileObjectId, ...brandUpdateData } = input.data;
        let confirmedLogoKey: string | undefined;

        if (fileObjectId) {
          const confirmedKey = await confirmPendingFile(tx, {
            fileObjectId,
            bucket: 'brand-logos',
            userId: ctx.session!.user.id,
          });
          if (!confirmedKey) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Il file caricato non è più disponibile, ricaricalo',
            });
          }

          confirmedLogoKey = confirmedKey;
          oldLogoKey = existingBrand.logoKey;
        }

        return tx.brand.update({
          where: { id: input.id },
          data: { ...brandUpdateData, updatedAt: new Date(), ...(confirmedLogoKey ? { logoKey: confirmedLogoKey } : {}) },
          select: BRAND_SELECT,
        });
      }, { timeout: 15000 });

      if (oldLogoKey) {
        const keyToDelete = oldLogoKey;
        setImmediate(async () => {
          try {
            await deleteObjectByKey(ctx, { bucket: 'brand-logos', key: keyToDelete });
          } catch (err) {
            ctx.logger?.warn({ err }, 'Failed to cleanup old logo after brand update');
          }
        });
      }

      await logAudit(ctx, { action: 'BRAND_UPDATE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: result.name } });
      const resolveUpdate = result.logoKey ? await makeUrlResolver(ctx.prisma) : null;
      return { ...result, logoUrl: result.logoKey && resolveUpdate ? resolveUpdate('brand-logos', result.logoKey) : null };
    }),

  /**
   * Soft-deletes a brand by setting isActive=false.
   *
   * @auth {brands:delete}
   * @input {BrandIdSchema} — brand UUID.
   * @output {Brand} — the updated brand record.
   */
  remove: protectedProcedure
    .use(requirePermission('brands:delete'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const existingBrand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!existingBrand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      const result = await ctx.prisma.brand.update({
        where: { id: input.id },
        data: { isActive: false, updatedAt: new Date() },
        select: BRAND_SELECT,
      });

      await logAudit(ctx, { action: 'BRAND_SOFT_DELETE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: existingBrand.name } });
      const resolveRemove = result.logoKey ? await makeUrlResolver(ctx.prisma) : null;
      return { ...result, logoUrl: result.logoKey && resolveRemove ? resolveRemove('brand-logos', result.logoKey) : null };
    }),

  /**
   * Unlinks the NAV association and soft-deletes the brand atomically; blocked if active layouts or pricing sets exist.
   *
   * @auth {brands:delete}
   * @input {BrandIdSchema} — brand UUID.
   * @output {Brand} — the updated brand record.
   */
  unlink: protectedProcedure
    .use(requirePermission('brands:delete'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const brand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!brand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      if (brand.navBrandId === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Il brand non è collegato a NAV' });
      }

      await assertUnreferenced(ctx.prisma, { brandId: input.id }, 'Impossibile scollegare: il brand è ancora usato');

      const result = await ctx.prisma.brand.update({
        where: { id: input.id },
        data: { navBrandId: null, isActive: false, updatedAt: new Date() },
        select: BRAND_SELECT,
      });

      await logAudit(ctx, { action: 'BRAND_NAV_UNLINK', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: brand.name, previousNavBrandId: brand.navBrandId } });
      const resolveUnlink = result.logoKey ? await makeUrlResolver(ctx.prisma) : null;
      return { ...result, logoUrl: result.logoKey && resolveUnlink ? resolveUnlink('brand-logos', result.logoKey) : null };
    }),

  /**
   * Permanently deletes a brand; refused while it is linked to NAV (BAD_REQUEST) or anything
   * references it (PRECONDITION_FAILED, with the counts), also when either arrives during the delete
   * (CONFLICT if what refused it is gone by the recount).
   *
   * A wrong or missing `confirmPhrase` is rejected in input validation, so it never reaches this
   * body and never reaches the audit log — the same as any other malformed field.
   *
   * @auth {*:*} — admin only. `brands:delete` is not enough: a permanent delete is not the
   *   archive that permission is for.
   * @input {BrandHardDeleteInputSchema} — brand UUID plus the typed confirmation.
   * @output {{ success: true }}
   */
  hardDelete: protectedProcedure
    .use(requirePermission('*:*'))
    .use(withRateLimit('brandMutations'))
    .input(BrandHardDeleteInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Read again when the delete finds nothing: the brand was deleted or linked to NAV meanwhile.
      const deletable = async () => {
        const brand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });
        if (!brand) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
        }
        if (brand.navBrandId !== null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Impossibile eliminare definitivamente un brand collegato a NAV. Usa "Scollega da NAV" prima.',
          });
        }
        return brand;
      };
      const brand = await deletable();

      // The NAV check holds to the delete: a link made meanwhile leaves nothing to delete.
      const { count } = await deleteUnreferenced(ctx.prisma, { brandId: input.id }, 'Impossibile eliminare: il brand è ancora usato', () =>
        ctx.prisma.brand.deleteMany({ where: { id: input.id, navBrandId: null } })
      );
      if (count === 0) {
        await deletable();
        throw new TRPCError({ code: 'CONFLICT', message: 'Il brand è cambiato nel frattempo: riprova' });
      }
      await logAudit(ctx, { action: 'BRAND_HARD_DELETE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: brand.name } });
      // After the delete, best effort: a failure leaves an orphan logo and a log line.
      if (brand.logoKey) {
        await deleteObjectByKey(ctx, { bucket: 'brand-logos', key: brand.logoKey }).catch((err: unknown) =>
          ctx.logger.warn({ err, key: brand.logoKey }, 'Hard delete: brand logo left behind')
        );
      }
      return { success: true };
    }),

  /**
   * What purging a brand would delete: counts, the seasons its data spans, the revision
   * pictures kept, and references from outside that would refuse it. Not authoritative: the purge
   * counts again under its locks.
   *
   * @auth {*:*} — admin only, as the purge.
   * @input {BrandIdSchema}
   * @output The preview of `previewPurge`.
   */
  purgePreview: protectedProcedure
    .use(requirePermission('*:*'))
    .input(BrandIdSchema)
    .query(({ input, ctx }) => previewPurge(ctx.prisma, 'brand', input.id)),

  /**
   * Deletes an inactive, NAV-free brand with everything under it (test data: a real one comes
   * from NAV), in one transaction with one audit entry; stored files and Google copies go after the
   * commit. See `purge` in `catalogDelete.service.ts`.
   *
   * @auth {*:*} — admin only, as the hard delete.
   * @input {PurgeInputSchema} — brand UUID plus its name, typed to confirm.
   * @output {{ deletedCounts, keptPictureReferences }}
   */
  purge: protectedProcedure
    .use(requirePermission('*:*'))
    .use(withRateLimit('brandMutations'))
    .input(PurgeInputSchema)
    .mutation(({ input, ctx }) => purge(ctx, 'brand', input.id, input.confirmName)),

  /**
   * Restores a soft-deleted brand by setting isActive=true.
   *
   * @auth {brands:update}
   * @input {BrandIdSchema} — brand UUID.
   * @output {Brand} — the restored brand record with resolved logoUrl.
   */
  restore: protectedProcedure
    .use(requirePermission('brands:update'))
    .use(withRateLimit('brandMutations'))
    .input(BrandIdSchema)
    .mutation(async ({ input, ctx }) => {
      const existingBrand = await ctx.prisma.brand.findUnique({ where: { id: input.id } });

      if (!existingBrand) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand non trovato' });
      }

      if (existingBrand.isActive) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Brand già attivo' });
      }

      const result = await ctx.prisma.brand.update({
        where: { id: input.id },
        data: { isActive: true, updatedAt: new Date() },
        select: BRAND_SELECT,
      });

      await logAudit(ctx, { action: 'BRAND_RESTORE', targetType: 'Brand', targetId: input.id, result: 'SUCCESS', metadata: { name: existingBrand.name } });
      const resolveRestore = result.logoKey ? await makeUrlResolver(ctx.prisma) : null;
      return { ...result, logoUrl: result.logoKey && resolveRestore ? resolveRestore('brand-logos', result.logoKey) : null };
    }),
});
