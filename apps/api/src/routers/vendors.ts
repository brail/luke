/**
 * Router tRPC per gestione Vendor (anagrafica interna fornitori)
 * Implementa CRUD completo con soft delete.
 *
 * Pattern soft delete:
 * - remove() imposta isActive=false anziché cancellare il record
 * - list() filtra isActive=true per default (includeInactive=true per admin)
 * - Il sync NAV non tocca mai isActive: un vendor disattivato non viene
 *   riattivato automaticamente dalla sincronizzazione successiva
 */

import { TRPCError } from '@trpc/server';

import {
  VendorInputSchema,
  VendorIdSchema,
  VendorListInputSchema,
  VendorUpdateInputSchema,
} from '@luke/core';

import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

const VENDOR_SELECT = {
  id: true,
  name: true,
  countryCode: true,
  nickname: true,
  referente: true,
  email: true,
  phone: true,
  chat: true,
  notes: true,
  navVendorId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const vendorsRouter = router({
  /**
   * Lista vendor con ricerca e cursor pagination.
   * Per default mostra solo isActive=true; passare includeInactive=true per vedere tutti.
   */
  list: protectedProcedure
    .use(requirePermission('vendors:read'))
    .input(VendorListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 100;

      const where: any = {};
      if (typeof input?.isActive === 'boolean') where.isActive = input.isActive;
      else where.isActive = true;
      if (input?.search) {
        where.OR = [
          { name: { contains: input.search, mode: 'insensitive' } },
          { nickname: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      const items = await ctx.prisma.vendor.findMany({
        where,
        take: limit + 1,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { name: 'asc' },
        select: VENDOR_SELECT,
      });

      const hasMore = items.length > limit;
      const results = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? results[results.length - 1].id : null;

      return { items: results, nextCursor, hasMore: !!nextCursor };
    }),

  /**
   * Singolo vendor per ID
   */
  getById: protectedProcedure
    .use(requirePermission('vendors:read'))
    .input(VendorIdSchema)
    .query(async ({ ctx, input }) => {
      const vendor = await ctx.prisma.vendor.findUnique({
        where: { id: input.id },
        select: VENDOR_SELECT,
      });

      if (!vendor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore non trovato' });
      }

      return vendor;
    }),

  /**
   * Crea un nuovo vendor
   */
  create: protectedProcedure
    .use(requirePermission('vendors:create'))
    .use(withRateLimit('configMutations'))
    .input(VendorInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.navVendorId) {
        const conflict = await ctx.prisma.vendor.findUnique({
          where: { navVendorId: input.navVendorId },
        });
        if (conflict) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Questo fornitore NAV è già collegato a un altro fornitore',
          });
        }
      }

      return ctx.prisma.vendor.create({
        data: { ...input, isActive: true },
        select: VENDOR_SELECT,
      });
    }),

  /**
   * Aggiorna un vendor esistente.
   * Non espone isActive — usare remove/restore per quello.
   */
  update: protectedProcedure
    .use(requirePermission('vendors:update'))
    .use(withRateLimit('configMutations'))
    .input(VendorUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const vendor = await ctx.prisma.vendor.findUnique({
        where: { id: input.id },
      });

      if (!vendor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore non trovato' });
      }

      if (input.data.navVendorId !== undefined && input.data.navVendorId !== vendor.navVendorId) {
        // Blocca qualsiasi cambio se già valorizzato — usare endpoint unlink
        if (vendor.navVendorId !== null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Il collegamento NAV non può essere modificato. Usa "Scollega da NAV" per rimuoverlo.',
          });
        }
        const navId = input.data.navVendorId;
        if (navId) {
          const conflict = await ctx.prisma.vendor.findUnique({ where: { navVendorId: navId } });
          if (conflict) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Questo fornitore NAV è già collegato a un altro fornitore',
            });
          }
        }
      }

      return ctx.prisma.vendor.update({
        where: { id: input.id },
        data: { ...input.data, updatedAt: new Date() },
        select: VENDOR_SELECT,
      });
    }),

  /**
   * Soft delete: imposta isActive=false.
   * Il record rimane in DB; le collection rows mantengono il riferimento
   * ma il vendor non appare più nel combobox né nella lista default.
   * Il sync NAV non riattiva mai un vendor soft-deleted.
   */
  remove: protectedProcedure
    .use(requirePermission('vendors:delete'))
    .input(VendorIdSchema)
    .mutation(async ({ input, ctx }) => {
      const vendor = await ctx.prisma.vendor.findUnique({
        where: { id: input.id },
      });

      if (!vendor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore non trovato' });
      }

      await ctx.prisma.vendor.update({
        where: { id: input.id },
        data: { isActive: false, updatedAt: new Date() },
      });

      return { success: true };
    }),

  /**
   * Scollega vendor da NAV e lo soft-deletes atomicamente.
   * Blocca se il vendor è referenziato in CollectionLayoutRow attive.
   */
  unlink: protectedProcedure
    .use(requirePermission('vendors:delete'))
    .use(withRateLimit('configMutations'))
    .input(VendorIdSchema)
    .mutation(async ({ input, ctx }) => {
      const vendor = await ctx.prisma.vendor.findUnique({ where: { id: input.id } });

      if (!vendor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore non trovato' });
      }

      if (vendor.navVendorId === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Il fornitore non è collegato a NAV' });
      }

      const rowCount = await ctx.prisma.collectionLayoutRow.count({
        where: { vendorId: input.id },
      });

      if (rowCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Impossibile scollegare: il fornitore è usato in ${rowCount} righe di collection`,
        });
      }

      await ctx.prisma.vendor.update({
        where: { id: input.id },
        data: { navVendorId: null, isActive: false, updatedAt: new Date() },
      });

      return { success: true };
    }),

  /**
   * Hard delete vendor — solo per vendor senza collegamento NAV e senza dipendenze attive.
   */
  hardDelete: protectedProcedure
    .use(requirePermission('vendors:delete'))
    .use(withRateLimit('configMutations'))
    .input(VendorIdSchema)
    .mutation(async ({ input, ctx }) => {
      const vendor = await ctx.prisma.vendor.findUnique({ where: { id: input.id } });

      if (!vendor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore non trovato' });
      }

      if (vendor.navVendorId !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Impossibile eliminare definitivamente un fornitore collegato a NAV. Usa "Scollega da NAV" prima.',
        });
      }

      const rowCount = await ctx.prisma.collectionLayoutRow.count({
        where: { vendorId: input.id },
      });

      if (rowCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Impossibile eliminare: il fornitore è usato in ${rowCount} righe di collection`,
        });
      }

      await ctx.prisma.vendor.delete({ where: { id: input.id } });
      return { success: true };
    }),

  /**
   * Riattiva un vendor soft-deleted (admin only)
   */
  restore: protectedProcedure
    .use(requirePermission('vendors:update'))
    .input(VendorIdSchema)
    .mutation(async ({ input, ctx }) => {
      const vendor = await ctx.prisma.vendor.findUnique({
        where: { id: input.id },
      });

      if (!vendor) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore non trovato' });
      }

      return ctx.prisma.vendor.update({
        where: { id: input.id },
        data: { isActive: true, updatedAt: new Date() },
        select: VENDOR_SELECT,
      });
    }),
});
