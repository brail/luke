import { randomUUID } from 'crypto';

import { z } from 'zod';

import { notificationCategoryEnum } from '@luke/core';

import { sseStore } from '../lib/sseStore';
import { protectedProcedure, router } from '../lib/trpc';

const CATEGORIES = notificationCategoryEnum.options;

export const notificationsRouter = router({
  /**
   * Lists notifications for the current user with cursor-based pagination.
   *
   * @auth {authenticated}
   * @input {{ limit?: number, cursor?: string, unreadOnly?: boolean }}
   * @output {{ items: Notification[], nextCursor: string | null }}
   */
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

  /**
   * Returns unread/read/total notification counts for the current user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ unread: number, read: number, total: number }}
   */
  counts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [unread, read] = await Promise.all([
      ctx.prisma.notification.count({ where: { userId, isRead: false } }),
      ctx.prisma.notification.count({ where: { userId, isRead: true } }),
    ]);
    return { unread, read, total: unread + read };
  }),

  /**
   * Marks a single notification as read for the current user.
   *
   * @auth {authenticated}
   * @input {{ id: string }}
   * @output {{ ok: true }}
   */
  markAsRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.notification.updateMany({
        where: { id: input.id, userId: ctx.session.user.id },
        data: { isRead: true, readAt: new Date() },
      });
      return { ok: true };
    }),

  /**
   * Marks all unread notifications as read for the current user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ ok: true }}
   */
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.notification.updateMany({
      where: { userId: ctx.session.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }),

  /**
   * Permanently deletes all read notifications for the current user.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ ok: true }}
   */
  deleteRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.notification.deleteMany({
      where: { userId: ctx.session.user.id, isRead: true },
    });
    return { ok: true };
  }),

  preferences: router({
    /**
     * Lists notification preferences for the current user across all categories (defaults to enabled).
     *
     * @auth {authenticated}
     * @input {none}
     * @output {Array<{ category: string, enabled: boolean }>}
     */
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

    /**
     * Enables or disables notifications for a specific category for the current user.
     *
     * @auth {authenticated}
     * @input {{ category: notificationCategoryEnum, enabled: boolean }}
     * @output {{ ok: true }}
     */
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

  /**
   * Issues a short-lived SSE ticket (UUID) that the client uses to open the SSE stream.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ ticket: string }}
   */
  getSseTicket: protectedProcedure.mutation(async ({ ctx }) => {
    const ticket = randomUUID();
    sseStore.createTicket(ticket, ctx.session.user.id);
    return { ticket };
  }),
});
