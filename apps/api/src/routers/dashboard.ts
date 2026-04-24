import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { type Prisma, type PrismaClient } from '@prisma/client';

import {
  DEFAULT_CLOCKS_TIMEZONES,
  DEFAULT_FOREX_PAIRS,
  DashboardTaskInputSchema,
  DashboardWidgetsSchema,
  type WidgetConfigItem,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { protectedProcedure, router } from '../lib/trpc';

async function getUserPrefContext(userId: string, prisma: PrismaClient) {
  const prefs = await prisma.userPreference.findUnique({ where: { userId } });
  const data = (prefs?.data ?? {}) as Record<string, unknown>;
  return {
    lastBrandId: data.lastBrandId as string | undefined,
    lastSeasonId: data.lastSeasonId as string | undefined,
  };
}

const DEFAULT_WIDGETS: WidgetConfigItem[] = [
  { id: 'kpi-stats',       enabled: true, position: 0 },
  { id: 'season-progress', enabled: true, position: 1 },
  { id: 'weekly-sales',    enabled: true, position: 2 },
  { id: 'tasks',           enabled: true, position: 3 },
  { id: 'forex',           enabled: true, position: 4, settings: { pairs: [...DEFAULT_FOREX_PAIRS] } },
  { id: 'clocks',          enabled: true, position: 5, settings: { timezones: [...DEFAULT_CLOCKS_TIMEZONES] } },
];

export const dashboardRouter = router({
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const record = await ctx.prisma.dashboardConfig.findUnique({ where: { userId } });
    if (!record) {
      return { widgets: DEFAULT_WIDGETS };
    }
    const parsed = DashboardWidgetsSchema.safeParse(record.widgets);
    if (!parsed.success) {
      return { widgets: DEFAULT_WIDGETS };
    }
    const savedIds = new Set(parsed.data.map(w => w.id));
    const missing = DEFAULT_WIDGETS.filter(w => !savedIds.has(w.id)).map((w, i) => ({
      ...w,
      position: parsed.data.length + i,
    }));
    return { widgets: [...parsed.data, ...missing] };
  }),

  saveConfig: protectedProcedure
    .input(z.object({ widgets: DashboardWidgetsSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const widgetsJson = input.widgets as unknown as Prisma.InputJsonValue;
      await ctx.prisma.dashboardConfig.upsert({
        where: { userId },
        create: { userId, widgets: widgetsJson },
        update: { widgets: widgetsJson },
      });
      return { ok: true };
    }),

  getTasks: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    return ctx.prisma.dashboardTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }),

  upsertTask: protectedProcedure
    .input(DashboardTaskInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, label, done, dueDate } = input;

      const task = await ctx.prisma.$transaction(async tx => {
        if (id) {
          const existing = await tx.dashboardTask.findFirst({ where: { id, userId } });
          if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Task non trovato' });
          }
          return tx.dashboardTask.update({
            where: { id },
            data: { label, done, dueDate: dueDate ? new Date(dueDate) : null },
          });
        }
        return tx.dashboardTask.create({
          data: { userId, label, done, dueDate: dueDate ? new Date(dueDate) : null },
        });
      });

      await logAudit(ctx, {
        action: id ? 'DASHBOARD_TASK_UPDATE' : 'DASHBOARD_TASK_CREATE',
        targetType: 'DashboardTask',
        targetId: task.id,
        metadata: { label: task.label, done: task.done },
      });

      return task;
    }),

  deleteTask: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const existing = await ctx.prisma.dashboardTask.findFirst({
        where: { id: input.id, userId },
      });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task non trovato' });
      }
      await ctx.prisma.dashboardTask.delete({ where: { id: input.id } });
      await logAudit(ctx, {
        action: 'DASHBOARD_TASK_DELETE',
        targetType: 'DashboardTask',
        targetId: input.id,
        metadata: { label: existing.label },
      });
      return { ok: true };
    }),

  getKpiStats: protectedProcedure.query(async ({ ctx }) => {
    const [brands, seasons, users, collectionRows] = await Promise.all([
      ctx.prisma.brand.count({ where: { isActive: true } }),
      ctx.prisma.season.count({ where: { isActive: true } }),
      ctx.prisma.user.count({ where: { isActive: true } }),
      ctx.prisma.collectionLayoutRow.count(),
    ]);
    return { brands, seasons, users, collectionRows };
  }),

  getForexRates: protectedProcedure
    .input(z.object({ pairs: z.array(z.string().regex(/^[A-Z]{3}\/[A-Z]{3}$/)).min(1).max(8) }))
    .query(async ({ ctx, input }) => {
      const byBase = new Map<string, string[]>();
      for (const pair of input.pairs) {
        const [base, quote] = pair.split('/');
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base)!.push(quote);
      }

      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const rates: Record<string, number> = {};
      const previousRates: Record<string, number> = {};
      let timestamp = new Date().toISOString();

      await Promise.all(
        Array.from(byBase.entries()).map(async ([base, quotes]) => {
          const toParam = quotes.join(',');
          const [latestRes, prevRes] = await Promise.all([
            fetch(`https://api.frankfurter.app/latest?from=${base}&to=${toParam}`, { signal: AbortSignal.timeout(8000) }),
            fetch(`https://api.frankfurter.app/${yesterday}?from=${base}&to=${toParam}`, { signal: AbortSignal.timeout(8000) }),
          ]);

          if (latestRes.ok) {
            const data = (await latestRes.json()) as { rates: Record<string, number>; date: string };
            timestamp = data.date;
            for (const [quote, rate] of Object.entries(data.rates)) {
              rates[`${base}/${quote}`] = rate;
            }
          } else {
            ctx.logger.warn({ status: latestRes.status }, 'forex latest fetch failed');
          }

          if (prevRes.ok) {
            const data = (await prevRes.json()) as { rates: Record<string, number> };
            for (const [quote, rate] of Object.entries(data.rates)) {
              previousRates[`${base}/${quote}`] = rate;
            }
          }
        })
      );

      return { rates, previousRates, timestamp };
    }),

  getWeeklySales: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const { lastBrandId, lastSeasonId } = await getUserPrefContext(userId, ctx.prisma);
    if (!lastBrandId || !lastSeasonId) return [] as { date: string; count: number }[];

    const [brand, season] = await Promise.all([
      ctx.prisma.brand.findUnique({ where: { id: lastBrandId }, select: { code: true } }),
      ctx.prisma.season.findUnique({ where: { id: lastSeasonId }, select: { code: true } }),
    ]);
    if (!brand || !season) return [] as { date: string; count: number }[];

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const headers = await ctx.prisma.navPfSalesHeader.findMany({
      where: {
        sellingSeasonCode: season.code,
        shortcutDimension2Code: brand.code,
        orderDate: { gte: sevenDaysAgo },
      },
      select: { orderDate: true },
    });

    const result: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      result.push({ date: d.toISOString().split('T')[0], count: 0 });
    }

    const byDate = new Map(result.map(r => [r.date, r]));
    for (const h of headers) {
      if (!h.orderDate) continue;
      const slot = byDate.get(h.orderDate.toISOString().split('T')[0]);
      if (slot) slot.count++;
    }

    return result;
  }),

  getSeasonProgress: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const { lastBrandId, lastSeasonId } = await getUserPrefContext(userId, ctx.prisma);
    if (!lastBrandId || !lastSeasonId) return null;

    const layout = await ctx.prisma.collectionLayout.findFirst({
      where: { brandId: lastBrandId, seasonId: lastSeasonId },
      include: {
        rows: { select: { skuForecast: true } },
        groups: { select: { id: true } },
        brand: { select: { name: true } },
        season: { select: { name: true } },
      },
    });
    if (!layout) return null;

    const skuForecast = layout.rows.reduce((sum, r) => sum + (r.skuForecast ?? 0), 0);
    return {
      brandName: layout.brand.name,
      seasonName: layout.season.name,
      skuBudget: layout.skuBudget,
      skuForecast,
      rowCount: layout.rows.length,
      groupCount: layout.groups.length,
    };
  }),
});
