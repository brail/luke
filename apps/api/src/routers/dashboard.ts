import { TRPCError } from '@trpc/server';
import { z } from 'zod';


import {
  DEFAULT_CLOCKS_TIMEZONES,
  DEFAULT_FOREX_PAIRS,
  DashboardTaskInputSchema,
  DashboardWidgetsSaveSchema,
  DashboardWidgetsSchema,
  FOREX_PAIR_PATTERN,
  FrankfurterRatesSchema,
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  utcMidnightOf,
  type CalendarDate,
  type WidgetConfigItem,
} from '@luke/core';
import { type Prisma } from '@luke/db';

import { logAudit } from '../lib/auditLog';
import { getConfigOrDefault } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { protectedProcedure, router, selfProcedure } from '../lib/trpc';
import { assertBrandAccess } from '../services/context.service';


const DEFAULT_WIDGETS: WidgetConfigItem[] = [
  { id: 'kpi-stats',       enabled: true, position: 0 },
  { id: 'season-progress', enabled: true, position: 1 },
  { id: 'weekly-sales',    enabled: true, position: 2 },
  { id: 'tasks',           enabled: true, position: 3 },
  { id: 'forex',           enabled: true, position: 4, settings: { pairs: [...DEFAULT_FOREX_PAIRS] } },
  { id: 'clocks',          enabled: true, position: 5, settings: { timezones: [...DEFAULT_CLOCKS_TIMEZONES] } },
];

export const dashboardRouter = router({
  /**
   * Returns the current user's dashboard widget configuration, merging missing default widgets.
   * Settings a widget's schema refuses, stored before saves were checked, come back dropped
   * (`DashboardWidgetsSchema`): the widget shows its defaults and the next save is accepted.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ widgets: WidgetConfigItem[] }}
   */
  getConfig: selfProcedure.query(async ({ ctx }) => {
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

  /**
   * Persists the current user's dashboard widget configuration.
   *
   * @auth {authenticated}
   * @input {{ widgets: DashboardWidgetsSaveSchema }} — ordered widget config array; clock zones and
   *   forex pairs are validated (a zone stored in the spelling `Intl` gives it). `getConfig` drops
   *   settings stored before that check, so the layout it returns always saves.
   * @output {{ ok: true }}
   */
  saveConfig: selfProcedure
    .input(z.object({ widgets: DashboardWidgetsSaveSchema }))
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

  /**
   * Returns the current user's dashboard tasks, newest first (limit 50).
   *
   * @auth {authenticated}
   * @input {none}
   * @output {DashboardTask[]}
   */
  getTasks: selfProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    return ctx.prisma.dashboardTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }),

  /**
   * Creates or updates a dashboard task for the current user.
   *
   * @auth {authenticated}
   * @input {DashboardTaskInputSchema} — optional id (update if present), label, optional done and
   *   dueDate (a `YYYY-MM-DD` day). On an update, a field left out keeps its stored value; a `null`
   *   dueDate clears it.
   * @output {DashboardTask}
   */
  upsertTask: selfProcedure
    .input(DashboardTaskInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, label, done, dueDate } = input;

      // A calendar day, stored at UTC midnight.
      const due = dueDate == null ? dueDate : utcMidnightOf(dueDate);
      const task = await ctx.prisma.$transaction(async tx => {
        if (id) {
          const existing = await tx.dashboardTask.findFirst({ where: { id, userId } });
          if (!existing) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Task non trovato' });
          }
          return tx.dashboardTask.update({
            where: { id },
            data: { label, done, dueDate: due },
          });
        }
        return tx.dashboardTask.create({
          data: { userId, label, done, dueDate: due },
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

  /**
   * Deletes a dashboard task owned by the current user.
   *
   * @auth {authenticated}
   * @input {{ id: string }} — task UUID.
   * @output {{ ok: true }}
   */
  deleteTask: selfProcedure
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

  /**
   * Returns aggregate KPI counts: active brands, seasons, users, and collection rows.
   *
   * @auth {dashboard:read}
   * @input {none}
   * @output {{ brands, seasons, users, collectionRows: number }}
   */
  getKpiStats: protectedProcedure
    .use(requirePermission('dashboard:read'))
    .query(async ({ ctx }) => {
      const [brands, seasons, users, collectionRows] = await Promise.all([
        ctx.prisma.brand.count({ where: { isActive: true } }),
        ctx.prisma.season.count({ where: { isActive: true } }),
        ctx.prisma.user.count({ where: { isActive: true } }),
        ctx.prisma.collectionLayoutRow.count(),
      ]);
      return { brands, seasons, users, collectionRows };
    }),

  /**
   * Fetches live FX rates from Frankfurter API for the requested currency pairs: the latest ECB
   * fixing and the one before it, to compare. A base Frankfurter fails for is left out.
   *
   * @auth {dashboard:read}
   * @input {{ pairs: string[] }} — 1–8 currency pairs in "BASE/QUOTE" format (e.g. "EUR/USD").
   * @output {{ rates, previousRates: Record<string, number>, timestamp: CalendarDate | null }} —
   *   `timestamp` is the latest fixing's day.
   * @throws {TRPCError} BAD_GATEWAY when Frankfurter answers for no base.
   */
  getForexRates: protectedProcedure
    .use(requirePermission('dashboard:read'))
    .input(z.object({ pairs: z.array(z.string().regex(FOREX_PAIR_PATTERN)).min(1).max(8) }))
    .query(async ({ ctx, input }) => {
      const byBase = new Map<string, string[]>();
      for (const pair of input.pairs) {
        const [base, quote] = pair.split('/');
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base)!.push(quote);
      }

      const rates: Record<string, number> = {};
      const previousRates: Record<string, number> = {};

      /** Frankfurter's rates at `path`, validated; `null`, with a warning, when it fails or answers something else. */
      const fetchRates = async (path: string) => {
        const res = await fetch(`https://api.frankfurter.app/${path}`, { signal: AbortSignal.timeout(8000) }).catch((err: unknown) => {
          ctx.logger.warn({ err, path }, 'forex fetch failed');
          return null;
        });
        if (!res) return null;
        if (!res.ok) {
          await res.body?.cancel();
          ctx.logger.warn({ status: res.status, path }, 'forex fetch failed');
          return null;
        }
        const parsed = FrankfurterRatesSchema.safeParse(await res.json().catch(() => null));
        if (!parsed.success) ctx.logger.warn({ path }, 'forex answer not understood');
        return parsed.success ? parsed.data : null;
      };

      const fixingDays = await Promise.all(
        Array.from(byBase.entries()).map(async ([base, quotes]): Promise<CalendarDate | null> => {
          const query = `from=${base}&to=${quotes.join(',')}`;
          const latest = await fetchRates(`latest?${query}`);
          if (!latest) return null;
          for (const [quote, rate] of Object.entries(latest.rates)) rates[`${base}/${quote}`] = rate;

          // The fixing before the latest one: Frankfurter answers a day with the last ECB working day's
          // fixing on or before it, so no clock or zone decides which day "yesterday" is.
          const previous = await fetchRates(`${addCalendarDays(latest.date, -1)}?${query}`);
          for (const [quote, rate] of Object.entries(previous?.rates ?? {})) previousRates[`${base}/${quote}`] = rate;
          return latest.date;
        })
      );
      // Nothing at all is a failure, so the client keeps the rates it has and retries.
      if (Object.keys(rates).length === 0) {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Cambi non disponibili: Frankfurter non risponde' });
      }

      return { rates, previousRates, timestamp: fixingDays.find(day => day !== null) ?? null };
    }),

  /**
   * Returns daily sales order counts for the 7 days ending today in the business time zone
   * (`app.defaultTimezone`) for a brand/season.
   *
   * @auth {sales:read}
   * @input {{ brandId: string, seasonId: string }}
   * @output {Array<{ date: CalendarDate, count: number }>} — 7 entries, one per day.
   */
  getWeeklySales: protectedProcedure
    .use(requirePermission('sales:read'))
    .input(z.object({ brandId: z.string(), seasonId: z.string() }))
    .query(async ({ ctx, input }) => {
    await assertBrandAccess(ctx, input.brandId);

    const [brand, season, timeZone] = await Promise.all([
      ctx.prisma.brand.findUnique({ where: { id: input.brandId }, select: { code: true } }),
      ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { code: true } }),
      getConfigOrDefault(ctx.prisma, 'app.defaultTimezone'),
    ]);
    if (!brand || !season) return [];

    const today = calendarDateIn(new Date(), timeZone);
    const result: { date: CalendarDate; count: number }[] = Array.from({ length: 7 }, (_, i) => ({
      date: addCalendarDays(today, i - 6),
      count: 0,
    }));

    const headers = await ctx.prisma.navPfSalesHeader.findMany({
      where: {
        sellingSeasonCode: season.code,
        shortcutDimension2Code: brand.code,
        orderDate: { gte: utcMidnightOf(addCalendarDays(today, -6)) },
      },
      select: { orderDate: true },
    });

    // `orderDate` is a NAV date, synced as its UTC midnight: read it as the date it is.
    const byDate = new Map(result.map(r => [r.date, r]));
    for (const h of headers) {
      if (!h.orderDate) continue;
      const slot = byDate.get(calendarDateOf(h.orderDate));
      if (slot) slot.count++;
    }

    return result;
  }),

  /**
   * Returns collection layout progress summary (skuBudget, skuForecast, row and group counts).
   *
   * @auth {collection_layout:read}
   * @input {{ brandId: string, seasonId: string }}
   * @output {{ brandName, seasonName, skuBudget, skuForecast, rowCount, groupCount } | null}
   */
  getSeasonProgress: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ brandId: z.string(), seasonId: z.string() }))
    .query(async ({ ctx, input }) => {
    await assertBrandAccess(ctx, input.brandId);

    const layout = await ctx.prisma.collectionLayout.findFirst({
      where: { brandId: input.brandId, seasonId: input.seasonId },
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
