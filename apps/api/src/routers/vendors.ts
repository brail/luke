/**
 * Router tRPC per gestione Vendor (anagrafica interna fornitori)
 * Implementa CRUD completo.
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
  nickname: true,
  referente: true,
  email: true,
  phone: true,
  chat: true,
  notes: true,
  navVendorId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const vendorsRouter = router({
  /**
   * Lista vendor con ricerca e cursor pagination
   */
  list: protectedProcedure
    .use(requirePermission('vendors:read'))
    .input(VendorListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const cursor = input?.cursor;
      const limit = input?.limit ?? 100;

      const where: any = {};
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
        data: input,
        select: VENDOR_SELECT,
      });
    }),

  /**
   * Aggiorna un vendor esistente
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

      if (input.data.navVendorId !== undefined) {
        const navId = input.data.navVendorId;
        if (navId && navId !== vendor.navVendorId) {
          const conflict = await ctx.prisma.vendor.findUnique({
            where: { navVendorId: navId },
          });
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
   * Elimina un vendor (hard delete — non ci sono dipendenze critiche)
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

      await ctx.prisma.vendor.delete({ where: { id: input.id } });
      return { success: true };
    }),
});
