import { randomUUID } from 'crypto';

import { z } from 'zod';

import { notificationCategoryEnum } from '@luke/core';

import { sseStore } from '../lib/sseStore';
import { protectedProcedure, router } from '../lib/trpc';

const CATEGORIES = notificationCategoryEnum.options;

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
        unreadOnly: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { limit, cursor, unreadOnly } = input;
      const userId = ctx.session.user.id;

      const items = await ctx.prisma.notification.findMany({
        where: {
          userId,
          ...(unreadOnly ? { isRead: false } : {}),
          ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          category: true,
          title: true,
          message: true,
          link: true,
          isRead: true,
          readAt: true,
          createdAt: true,
        },
      });

      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;

      return { items: page, nextCursor };
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.notification.count({
      where: { userId: ctx.session.user.id, isRead: false },
    });
  }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.notification.updateMany({
        where: { id: input.id, userId: ctx.session.user.id },
        data: { isRead: true, readAt: new Date() },
      });
      return { ok: true };
    }),

  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.notification.updateMany({
      where: { userId: ctx.session.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }),

  deleteRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.notification.deleteMany({
      where: { userId: ctx.session.user.id, isRead: true },
    });
    return { ok: true };
  }),

  preferences: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.session.user.id;

      const stored = await ctx.prisma.notificationPreference.findMany({
        where: { userId },
        select: { category: true, enabled: true },
      });

      const storedMap = new Map(stored.map(p => [p.category, p.enabled]));

      // Restituisce tutte le categorie, default enabled se nessuna riga presente
      return CATEGORIES.map(category => ({
        category,
        enabled: storedMap.get(category) ?? true,
      }));
    }),

    update: protectedProcedure
      .input(z.object({ category: notificationCategoryEnum, enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.prisma.notificationPreference.upsert({
          where: { userId_category: { userId: ctx.session.user.id, category: input.category } },
          create: { userId: ctx.session.user.id, category: input.category, enabled: input.enabled },
          update: { enabled: input.enabled },
        });
        return { ok: true };
      }),
  }),

  getSseTicket: protectedProcedure.mutation(async ({ ctx }) => {
    const ticket = randomUUID();
    sseStore.createTicket(ticket, ctx.session.user.id);
    return { ticket };
  }),
});
