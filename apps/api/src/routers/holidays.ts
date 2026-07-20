import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logAudit } from '../lib/auditLog.js';
import { requirePermission } from '../lib/permissions.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import { resolveCompanyCountryCode } from '../services/companyProfile.service.js';

// ─── Nager.Date API ──────────────────────────────────────────────────────────

const NAGER_BASE = 'https://date.nager.at/api/v3';

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
}

async function fetchNagerHolidays(countryCode: string, year: number): Promise<NagerHoliday[]> {
  const res = await fetch(`${NAGER_BASE}/PublicHolidays/${year}/${countryCode}`);
  if (!res.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Nager.Date API error for ${countryCode}/${year}: ${res.status}`,
    });
  }
  return res.json() as Promise<NagerHoliday[]>;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const holidaysRouter = router({
  /**
   * Returns the list of country codes derived from active vendors and the company profile.
   *
   * @auth {config:read}
   * @input {none}
   * @output {Array<{ code: string, name: string }>} — country codes relevant to the company.
   */
  listCountries: protectedProcedure
    .use(requirePermission('config:read'))
    .query(async ({ ctx }) => {
      const [vendors, companyCountryCode] = await Promise.all([
        ctx.prisma.vendor.findMany({
          where: { isActive: true, countryCode: { not: null } },
          select: { countryCode: true },
          distinct: ['countryCode'],
          orderBy: { countryCode: 'asc' },
        }),
        resolveCompanyCountryCode(ctx.prisma),
      ]);

      const codeSet = new Set(vendors.map(v => v.countryCode as string));
      if (companyCountryCode) codeSet.add(companyCountryCode);
      const codes = [...codeSet].sort();
      if (codes.length === 0) return [];

      const known = await ctx.prisma.holidayCountry.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameMap = new Map(known.map(c => [c.code, c.name]));
      return codes.map(code => ({ code, name: nameMap.get(code) ?? code }));
    }),

  /**
   * Previews holidays to be imported from Nager.Date API without persisting them.
   *
   * @auth {config:update}
   * @input {{ countryCodes: string[], year: number }} — 1–10 ISO 3166-1 alpha-2 codes and year.
   * @output {Array<{ code, name, nameEn, date }>} — flattened holiday preview list.
   */
  previewImport: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({
      countryCodes: z.array(z.string().length(2)).min(1).max(10),
      year: z.number().int().min(2020).max(2040),
    }))
    .query(async ({ input }) => {
      const results = await Promise.allSettled(
        input.countryCodes.map(async code => {
          const holidays = await fetchNagerHolidays(code, input.year);
          return { code, holidays };
        }),
      );

      const preview: Array<{ code: string; name: string; nameEn: string | null; date: string }> = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          for (const h of r.value.holidays) {
            const localName = h.localName || h.name;
            preview.push({
              code: h.countryCode,
              name: localName,
              nameEn: h.name !== localName ? h.name : null,
              date: h.date,
            });
          }
        }
      }
      return preview;
    }),

  /**
   * Imports public holidays from Nager.Date API into the database (upsert by country+name+date).
   *
   * @auth {config:update}
   * @input {{ countryCodes: string[], year: number }}
   * @output {{ imported: number }}
   */
  confirmImport: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({
      countryCodes: z.array(z.string().length(2)).min(1).max(10),
      year: z.number().int().min(2020).max(2040),
    }))
    .mutation(async ({ input, ctx }) => {
      // Auto-upsert HolidayCountry rows (FK anchor) so any vendor country is accepted
      await Promise.all(
        input.countryCodes.map(code =>
          ctx.prisma.holidayCountry.upsert({
            where: { code },
            update: {},
            create: { code, name: code },
          }),
        ),
      );

      const results = await Promise.allSettled(
        input.countryCodes.map(code => fetchNagerHolidays(code, input.year)),
      );

      let imported = 0;
      for (let i = 0; i < input.countryCodes.length; i++) {
        const r = results[i]!;
        if (r.status !== 'fulfilled') continue;
        const code = input.countryCodes[i]!;

        for (const h of r.value) {
          const startDate = new Date(h.date);
          const endDate   = new Date(h.date); // single-day holidays from nager
          const name = h.localName || h.name;
          const nameEn = h.name !== name ? h.name : null;
          await ctx.prisma.holiday.upsert({
            where: {
              countryCode_name_startDate: {
                countryCode: code,
                name,
                startDate,
              },
            },
            update: { endDate, nameEn },
            create: {
              countryCode: code,
              name,
              nameEn,
              startDate,
              endDate,
              source: 'nager.date',
            },
          });
          imported++;
        }
      }

      await logAudit(ctx, {
        action: 'HOLIDAY_IMPORT',
        targetType: 'Holiday',
        targetId: `${input.year}/${input.countryCodes.join(',')}`,
        result: 'SUCCESS',
        metadata: { year: input.year, countryCodes: input.countryCodes, imported },
      });

      return { imported };
    }),

  /**
   * Lists stored public holidays, optionally filtered by country codes and/or year.
   *
   * @auth {config:read}
   * @input {{ countryCodes?: string[], year?: number }}
   * @output {Holiday[]}
   */
  listHolidays: protectedProcedure
    .use(requirePermission('config:read'))
    .input(z.object({
      countryCodes: z.array(z.string().length(2)).optional(),
      year: z.number().int().min(2020).max(2040).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const where: Record<string, unknown> = {};
      if (input.countryCodes?.length) where['countryCode'] = { in: input.countryCodes };
      if (input.year) {
        where['startDate'] = { gte: new Date(`${input.year}-01-01`) };
        where['endDate']   = { lte: new Date(`${input.year}-12-31`) };
      }
      return ctx.prisma.holiday.findMany({
        where,
        orderBy: [{ countryCode: 'asc' }, { startDate: 'asc' }],
      });
    }),

  /**
   * Hard-deletes a holiday record by ID.
   *
   * @auth {config:update}
   * @input {{ id: string }} — holiday UUID.
   * @output {{ success: true }}
   */
  deleteHoliday: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.holiday.delete({ where: { id: input.id } });
      await logAudit(ctx, {
        action: 'HOLIDAY_DELETE',
        targetType: 'Holiday',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });
      return { success: true };
    }),

  // ─── Vendor closures ───────────────────────────────────────────────────────

  /**
   * Lists vendor closure periods for a specific vendor and season.
   *
   * @auth {season_calendar:read}
   * @input {{ vendorId: string, seasonId: string }}
   * @output {VendorClosurePeriod[]} — sorted by startDate ascending.
   */
  listVendorClosures: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({
      vendorId: z.string().uuid(),
      seasonId: z.string().uuid(),
    }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.vendorClosurePeriod.findMany({
        where: { vendorId: input.vendorId, seasonId: input.seasonId },
        orderBy: { startDate: 'asc' },
      });
    }),

  /**
   * Lists vendor closure periods for several vendors and one season in a single query — the
   * planning wizard needs the union of closures across every vendor relevant to a planning
   * group's rows, and this replaces what used to be one `listVendorClosures` call per vendor
   * (capped at 8 to keep the hook count fixed client-side; no cap needed with a single query).
   *
   * @auth {season_calendar:read}
   * @input {{ vendorIds: string[], seasonId: string }} — 1–100 vendor UUIDs.
   * @output {VendorClosurePeriod[]} — sorted by startDate ascending, not grouped by vendor
   *   (callers needing per-vendor date ranges filter client-side; the planning wizard only
   *   needs the union).
   */
  listVendorClosuresBatch: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({
      vendorIds: z.array(z.string().uuid()).min(1).max(100),
      seasonId: z.string().uuid(),
    }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.vendorClosurePeriod.findMany({
        where: { vendorId: { in: input.vendorIds }, seasonId: input.seasonId },
        orderBy: { startDate: 'asc' },
      });
    }),

  /**
   * Pre-fills vendor closure periods from stored holidays for the given country codes.
   *
   * @auth {season_calendar:update}
   * @input {{ vendorId: string, seasonId: string, countryCodes: string[] }}
   * @output {{ created: number }}
   */
  prefillVendorClosures: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .input(z.object({
      vendorId: z.string().uuid(),
      seasonId: z.string().uuid(),
      countryCodes: z.array(z.string().length(2)).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const holidays = await ctx.prisma.holiday.findMany({
        where: { countryCode: { in: input.countryCodes } },
      });

      let created = 0;
      for (const h of holidays) {
        const exists = await ctx.prisma.vendorClosurePeriod.findFirst({
          where: {
            vendorId: input.vendorId,
            seasonId: input.seasonId,
            sourceHolidayId: h.id,
          },
        });
        if (exists) continue;

        await ctx.prisma.vendorClosurePeriod.create({
          data: {
            vendorId: input.vendorId,
            seasonId: input.seasonId,
            countryCode: h.countryCode,
            name: h.name,
            startDate: h.startDate,
            endDate: h.endDate,
            type: 'CLOSURE',
            sourceHolidayId: h.id,
          },
        });
        created++;
      }

      return { created };
    }),

  /**
   * Creates or updates a vendor closure period for a given vendor/season.
   *
   * @auth {season_calendar:update}
   * @input {{ id?, vendorId, seasonId, countryCode, name, startDate, endDate, type, notes? }}
   * @output {VendorClosurePeriod}
   */
  upsertVendorClosure: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .input(z.object({
      id: z.string().uuid().optional(),
      vendorId: z.string().uuid(),
      seasonId: z.string().uuid(),
      countryCode: z.string().length(2).nullable(),
      name: z.string().min(1).max(200),
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      type: z.enum(['CLOSURE', 'OPEN']),
      notes: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const startDate = new Date(input.startDate);
      const endDate   = new Date(input.endDate);

      if (input.countryCode) {
        await ctx.prisma.holidayCountry.upsert({
          where: { code: input.countryCode },
          update: {},
          create: { code: input.countryCode, name: input.countryCode },
        });
      }

      if (input.id) {
        const updated = await ctx.prisma.vendorClosurePeriod.update({
          where: { id: input.id },
          data: {
            countryCode: input.countryCode,
            name: input.name,
            startDate,
            endDate,
            type: input.type,
            notes: input.notes,
          },
        });
        await logAudit(ctx, { action: 'VENDOR_CLOSURE_UPDATE', targetType: 'VendorClosurePeriod', targetId: updated.id, result: 'SUCCESS', metadata: {} });
        return updated;
      }

      const created = await ctx.prisma.vendorClosurePeriod.create({
        data: {
          vendorId: input.vendorId,
          seasonId: input.seasonId,
          countryCode: input.countryCode,
          name: input.name,
          startDate,
          endDate,
          type: input.type,
          notes: input.notes,
        },
      });
      await logAudit(ctx, { action: 'VENDOR_CLOSURE_CREATE', targetType: 'VendorClosurePeriod', targetId: created.id, result: 'SUCCESS', metadata: {} });
      return created;
    }),

  /**
   * Hard-deletes a vendor closure period by ID.
   *
   * @auth {season_calendar:update}
   * @input {{ id: string }}
   * @output {{ success: true }}
   */
  deleteVendorClosure: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.vendorClosurePeriod.delete({ where: { id: input.id } });
      await logAudit(ctx, { action: 'VENDOR_CLOSURE_DELETE', targetType: 'VendorClosurePeriod', targetId: input.id, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  /**
   * Marks a set of vendor closure periods as confirmed by the current user.
   *
   * @auth {season_calendar:update}
   * @input {{ ids: string[] }} — UUIDs of closure periods to confirm.
   * @output {{ confirmed: number }}
   */
  confirmVendorClosures: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .input(z.object({
      ids: z.array(z.string().uuid()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      await ctx.prisma.vendorClosurePeriod.updateMany({
        where: { id: { in: input.ids } },
        data: {
          confirmedAt: now,
          confirmedByUserId: ctx.session.user.id,
        },
      });
      await logAudit(ctx, {
        action: 'VENDOR_CLOSURE_CONFIRM',
        targetType: 'VendorClosurePeriod',
        targetId: input.ids.join(','),
        result: 'SUCCESS',
        metadata: { count: input.ids.length },
      });
      return { confirmed: input.ids.length };
    }),
});
