import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { NagerHolidaysSchema, parseCalendarDate, utcMidnightOf, VendorClosureUpsertInputSchema } from '@luke/core';
import { Prisma } from '@luke/db';

import { logAudit } from '../lib/auditLog.js';
import { isForeignKeyViolation } from '../lib/error.js';
import { requirePermission } from '../lib/permissions.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import { resolveCompanyCountryCode } from '../services/companyProfile.service.js';

/** A closure write whose closure (P2025), vendor or season (foreign key) no longer exists is
 * NOT_FOUND, not a 500. */
function rethrowClosureNotFound(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Periodo non trovato' });
  }
  if (isForeignKeyViolation(e, 'vendor_closure_periods_vendorId_fkey') || isForeignKeyViolation(e, 'vendor_closure_periods_seasonId_fkey')) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore o stagione non trovati' });
  }
  throw e;
}

/**
 * The holidays overlapping the years `from` to `to` — a range from late December to early January
 * belongs to both years. Throws a `RangeError` for a year outside 1900–9999.
 */
function overlappingYears(from: number, to: number): Prisma.HolidayWhereInput {
  const first = parseCalendarDate(`${from}-01-01`);
  const last = parseCalendarDate(`${to}-12-31`);
  if (!first || !last) throw new RangeError(`Years outside 1900–9999: ${from}–${to}`);
  return { startDate: { lte: utcMidnightOf(last) }, endDate: { gte: utcMidnightOf(first) } };
}

// ─── Nager.Date API ──────────────────────────────────────────────────────────

const NAGER_BASE = 'https://date.nager.at/api/v3';

/** A preview or an import: the countries unique and sorted, so both list the same holidays and
 * concurrent imports take the countries' keys in the same order. */
const NagerImportInputSchema = z.object({
  countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(10).transform(codes => [...new Set(codes)].sort()),
  year: z.number().int().min(2020).max(2040),
});

/**
 * The public holidays Nager.Date lists for `countryCode` in `year`, validated: none for a country it
 * does not cover (404).
 *
 * @throws {TRPCError} BAD_REQUEST if Nager.Date cannot be reached, answers with an error, or sends
 *   an answer that is not a list of holidays on existing days.
 */
async function fetchNagerHolidays(countryCode: string, year: number) {
  const res = await fetch(`${NAGER_BASE}/PublicHolidays/${year}/${countryCode}`, { signal: AbortSignal.timeout(10_000) })
    .catch((cause: unknown) => {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Nager.Date non risponde per ${countryCode}`, cause });
    });
  if (res.status === 404) return [];
  if (!res.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Nager.Date non risponde per ${countryCode} (${res.status})` });
  const parsed = NagerHolidaysSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: `Risposta non valida da Nager.Date per ${countryCode}` });
  return parsed.data;
}

/** The holidays of `countryCodes` in `year`, all or nothing: one country that fails refuses them all. */
async function fetchAllNagerHolidays(countryCodes: string[], year: number) {
  const fetched = await Promise.all(countryCodes.map(async code => ({ code, holidays: await fetchNagerHolidays(code, year) })));
  return fetched.flatMap(({ code, holidays }) => holidays.map(h => {
    const name = h.localName || h.name;
    return { code, name, nameEn: h.name !== name ? h.name : null, date: h.date };
  }));
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
    // `season_calendar:read`, not `config:read`: this is the country list the calendar page renders,
    // reference data rather than configuration. Gated as config it was the one thing keeping that
    // permission necessary for a role that must not have it.
    .use(requirePermission('season_calendar:read'))
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
   * @throws {TRPCError} BAD_REQUEST as `confirmImport` does, so the preview never lists an import
   *   that would be refused.
   */
  previewImport: protectedProcedure
    .use(requirePermission('config:update'))
    .input(NagerImportInputSchema)
    .query(({ input }) => fetchAllNagerHolidays(input.countryCodes, input.year)),

  /**
   * Imports public holidays from Nager.Date API into the database (upsert by country+name+date), all
   * or nothing, in one transaction.
   *
   * @auth {config:update}
   * @input {{ countryCodes: string[], year: number }}
   * @output {{ imported: number }}
   * @throws {TRPCError} BAD_REQUEST if Nager.Date fails for a country (`fetchNagerHolidays`).
   */
  confirmImport: protectedProcedure
    .use(requirePermission('config:update'))
    .input(NagerImportInputSchema)
    .mutation(async ({ input, ctx }) => {
      // Every country is fetched and every day validated before anything is written.
      const holidays = await fetchAllNagerHolidays(input.countryCodes, input.year);

      await ctx.prisma.$transaction(async tx => {
        // The countries are the holidays' foreign-key anchor: any vendor country is accepted.
        await tx.holidayCountry.createMany({ data: input.countryCodes.map(code => ({ code, name: code })), skipDuplicates: true });
        for (const h of holidays) {
          // Single-day holidays from Nager.Date.
          const day = utcMidnightOf(h.date);
          await tx.holiday.upsert({
            where: { countryCode_name_startDate: { countryCode: h.code, name: h.name, startDate: day } },
            update: { endDate: day, nameEn: h.nameEn },
            create: { countryCode: h.code, name: h.name, nameEn: h.nameEn, startDate: day, endDate: day, source: 'nager.date' },
          });
        }
      }, { timeout: 15000 });
      const imported = holidays.length;

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
   * @auth {season_calendar:read} — the planning calendar marks holidays for everyone who reads it
   * @input {{ countryCodes?: string[], year?: number }}
   * @output {Holiday[]}
   */
  listHolidays: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({
      countryCodes: z.array(z.string().length(2)).optional(),
      year: z.number().int().min(2020).max(2040).optional(),
    }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.holiday.findMany({
        where: {
          countryCode: input.countryCodes?.length ? { in: input.countryCodes } : undefined,
          ...(input.year ? overlappingYears(input.year, input.year) : undefined),
        },
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
      // `delete` returns the removed record: the audit entry keeps describing it after the id
      // stops resolving to anything.
      const deleted = await ctx.prisma.holiday.delete({ where: { id: input.id } });
      await logAudit(ctx, {
        action: 'HOLIDAY_DELETE',
        targetType: 'Holiday',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { name: deleted.name, countryCode: deleted.countryCode, startAt: deleted.startDate.toISOString() },
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
   * Pre-fills vendor closure periods from the stored holidays of the given country codes: those
   * overlapping the season's year and the one before, when its planning starts, or of every year for
   * a season without one (as NAV creates them).
   *
   * @auth {season_calendar:configure} — admin-only: vendor closures are configured on an admin page
   * @input {{ vendorId: string, seasonId: string, countryCodes: string[] }}
   * @output {{ created: number }}
   * @throws {TRPCError} NOT_FOUND for a vendor or season that does not exist.
   */
  prefillVendorClosures: protectedProcedure
    .use(requirePermission('season_calendar:configure'))
    .input(z.object({
      vendorId: z.string().uuid(),
      seasonId: z.string().uuid(),
      countryCodes: z.array(z.string().length(2)).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const [vendor, season] = await Promise.all([
        ctx.prisma.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true } }),
        ctx.prisma.season.findUnique({ where: { id: input.seasonId }, select: { year: true } }),
      ]);
      // Read first: with nothing to copy, the write's foreign keys would not refuse a missing one.
      if (!vendor || !season) throw new TRPCError({ code: 'NOT_FOUND', message: 'Fornitore o stagione non trovati' });

      const holidays = await ctx.prisma.holiday.findMany({
        where: { countryCode: { in: input.countryCodes }, ...(season.year === null ? undefined : overlappingYears(season.year - 1, season.year)) },
      });

      // @@unique([vendorId, seasonId, sourceHolidayId]) makes this idempotent
      // under double submit — skipDuplicates replaces the previous
      // per-holiday findFirst+create, which left a race window between the
      // two queries.
      const { count: created } = await ctx.prisma.vendorClosurePeriod.createMany({
        data: holidays.map(h => ({
          vendorId: input.vendorId,
          seasonId: input.seasonId,
          countryCode: h.countryCode,
          name: h.name,
          startDate: h.startDate,
          endDate: h.endDate,
          type: 'CLOSURE' as const,
          sourceHolidayId: h.id,
        })),
        skipDuplicates: true,
      }).catch(rethrowClosureNotFound);

      return { created };
    }),

  /**
   * Creates or updates a vendor closure period for a given vendor/season.
   *
   * @auth {season_calendar:configure} — admin-only: vendor closures are configured on an admin page
   * @input {{ id?, vendorId, seasonId, countryCode, name, startDate, endDate, type, notes? }}
   * @output {VendorClosurePeriod}
   * @throws {TRPCError} NOT_FOUND for an `id` that is no closure of that vendor and season, or for a
   *   vendor or season that does not exist.
   */
  upsertVendorClosure: protectedProcedure
    .use(requirePermission('season_calendar:configure'))
    .input(VendorClosureUpsertInputSchema)
    .mutation(async ({ input, ctx }) => {
      const data = {
        countryCode: input.countryCode,
        name: input.name,
        startDate: utcMidnightOf(input.startDate),
        endDate: utcMidnightOf(input.endDate),
        type: input.type,
        notes: input.notes,
      };

      // The placeholder country commits with the closure, so a failed closure write leaves none.
      const closure = await ctx.prisma.$transaction(async tx => {
        if (input.countryCode) {
          await tx.holidayCountry.upsert({
            where: { code: input.countryCode },
            update: {},
            create: { code: input.countryCode, name: input.countryCode },
          });
        }
        // An update finds its closure under the vendor and season it names: a stale dialog's id is
        // gone, and another vendor's closure is not this request's to change.
        return input.id
          ? tx.vendorClosurePeriod.update({ where: { id: input.id, vendorId: input.vendorId, seasonId: input.seasonId }, data })
          : tx.vendorClosurePeriod.create({ data: { ...data, vendorId: input.vendorId, seasonId: input.seasonId } });
      }).catch(rethrowClosureNotFound);

      await logAudit(ctx, { action: input.id ? 'VENDOR_CLOSURE_UPDATE' : 'VENDOR_CLOSURE_CREATE', targetType: 'VendorClosurePeriod', targetId: closure.id, result: 'SUCCESS', metadata: { vendorId: closure.vendorId, seasonId: closure.seasonId, name: closure.name, type: closure.type } });
      return closure;
    }),

  /**
   * Hard-deletes a vendor closure period by ID.
   *
   * @auth {season_calendar:configure} — admin-only: vendor closures are configured on an admin page
   * @input {{ id: string }}
   * @output {{ success: true }}
   * @throws {TRPCError} NOT_FOUND for a closure already deleted.
   */
  deleteVendorClosure: protectedProcedure
    .use(requirePermission('season_calendar:configure'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await ctx.prisma.vendorClosurePeriod.delete({ where: { id: input.id } }).catch(rethrowClosureNotFound);
      await logAudit(ctx, { action: 'VENDOR_CLOSURE_DELETE', targetType: 'VendorClosurePeriod', targetId: input.id, result: 'SUCCESS', metadata: { vendorId: deleted.vendorId, seasonId: deleted.seasonId, name: deleted.name } });
      return { success: true };
    }),

  /**
   * Marks the unconfirmed closure periods among `ids` as confirmed by the current user; one already
   * confirmed keeps its author and time.
   *
   * @auth {season_calendar:configure} — admin-only: vendor closures are configured on an admin page
   * @input {{ ids: string[] }} — UUIDs of closure periods to confirm.
   * @output {{ confirmed: number }} — the rows this call confirmed; an id deleted or already confirmed
   *   is not counted.
   */
  confirmVendorClosures: protectedProcedure
    .use(requirePermission('season_calendar:configure'))
    .input(z.object({
      ids: z.array(z.string().uuid()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const { count } = await ctx.prisma.vendorClosurePeriod.updateMany({
        // Unconfirmed only: the list the dialog sent from may be stale, and a confirmation already
        // made keeps its author and time.
        where: { id: { in: input.ids }, confirmedAt: null },
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
        metadata: { count },
      });
      return { confirmed: count };
    }),
});
