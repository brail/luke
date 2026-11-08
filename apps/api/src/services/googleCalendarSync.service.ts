
import {
  createGoogleCalendarClient,
  syncMilestone,
  deleteEvent,
  buildCalendarSummary,
  createCalendar,
  deleteCalendar,
  syncCalendarAcl,
  googleErrorStatus,
  type MilestoneForSync,
  type SyncContext,
} from '@luke/calendar';
import { planningGroupName, type Role } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getConfig, getConfigOrDefault } from '../lib/configManager.js';

import { teamGrantsFunctionAndBrand } from './calendarAudience.service.js';
import { getUserAllowedIds } from './context.service.js';


interface SyncLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Reads Google integration config from AppConfig and initialises the Google Calendar client.
 * Supports oauth_user and service_account authentication modes.
 *
 * Event sync needs `integrations.google.calendarSync.enabled` on. Work that keeps existing Google
 * calendars in line with Luke (reader reconcile, deleting purged calendars) passes
 * `requireSyncEnabled: false`: turning event sync off must not freeze who can read them.
 *
 * @returns The configured workspace domain, or null if the integration is disabled or misconfigured.
 */
export async function getConfiguredGoogleClient(
  prisma: PrismaClient,
  { requireSyncEnabled = true }: { requireSyncEnabled?: boolean } = {}
): Promise<{ domain: string } | null> {
  const [authMode, domain, enabled] = await Promise.all([
    getConfig(prisma, 'integrations.google.authMode'),
    getConfig(prisma, 'integrations.google.domain'),
    getConfigOrDefault(prisma, 'integrations.google.calendarSync.enabled'),
  ]);

  if (!domain || (requireSyncEnabled && !enabled)) return null;

  if (authMode === 'oauth_user') {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      getConfig(prisma, 'integrations.google.oauth.clientId'),
      getConfig(prisma, 'integrations.google.oauth.clientSecret'),
      getConfig(prisma, 'integrations.google.oauth.refreshToken'),
    ]);
    if (!clientId || !clientSecret || !refreshToken) return null;
    createGoogleCalendarClient({ mode: 'oauth_user', clientId, clientSecret, refreshToken, workspaceDomain: domain });
  } else {
    const [serviceEmail, serviceKey, impersonateEmail] = await Promise.all([
      getConfig(prisma, 'integrations.google.serviceEmail'),
      getConfig(prisma, 'integrations.google.serviceKey'),
      getConfig(prisma, 'integrations.google.impersonateEmail'),
    ]);
    if (!serviceEmail || !serviceKey) return null;
    createGoogleCalendarClient({
      mode: 'service_account',
      serviceAccountEmail: serviceEmail,
      serviceAccountPrivateKey: serviceKey,
      workspaceDomain: domain,
      impersonateEmail: impersonateEmail || undefined,
    });
  }

  return { domain };
}

// ─── Milestone mapping ────────────────────────────────────────────────────────

type MilestoneRow = {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  cancelledAt: Date | null;
  publishExternally: boolean;
  visibilities: { functionId: string }[];
  planningGroup: { name: string | null };
};

function mapMilestone(m: MilestoneRow): MilestoneForSync {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    startAt: m.startAt,
    endAt: m.endAt,
    allDay: m.allDay,
    cancelled: !!m.cancelledAt,
    publishExternally: m.publishExternally,
    visibilityFunctionIds: m.visibilities.map(v => v.functionId),
    planningGroupName: planningGroupName(m.planningGroup),
  };
}

// ─── SyncContext builder ──────────────────────────────────────────────────────

/**
 * The Google Calendar readers of one (season calendar, function) pair: active admins, plus active
 * members of an active team that holds both the function and the season calendar's brand. Users
 * pending approval read nothing.
 */
export async function getCalendarReaderEmails(
  companyFunctionId: string,
  brandId: string,
  prisma: PrismaClient
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      pendingApproval: false,
      OR: [
        { role: 'admin' },
        { teamMemberships: { some: { team: teamGrantsFunctionAndBrand(companyFunctionId, brandId) } } },
      ],
    },
    select: { email: true },
  });
  return users.map(u => u.email).filter((e): e is string => !!e);
}

/**
 * Builds the SyncContext for a season calendar, wiring up the DB-backed callbacks
 * (getOrCreateBinding, getMappings, upsertMapping, deleteMapping) used by @luke/calendar sync.
 *
 * @returns A fully configured SyncContext ready to be passed to syncMilestone.
 */
export async function buildSyncContext(
  calendarId: string,
  prisma: PrismaClient
): Promise<SyncContext> {
  const cal = await prisma.seasonCalendar.findUniqueOrThrow({
    where: { id: calendarId },
    include: {
      brand: { select: { code: true } },
      season: { select: { code: true } },
    },
  });

  const brandCode = cal.brand.code;
  const seasonCode = cal.season.code;

  return {
    seasonCalendarId: calendarId,
    brandCode,
    seasonCode,

    getOrCreateBinding: async (companyFunctionId) => {
      const existing = await prisma.googleCalendarBinding.findUnique({
        where: { seasonCalendarId_companyFunctionId: { seasonCalendarId: calendarId, companyFunctionId } },
      });
      if (existing?.isProvisioned) return existing;

      const fn = await prisma.companyFunction.findUnique({
        where: { id: companyFunctionId },
        select: { name: true },
      });
      const summary = buildCalendarSummary(brandCode, seasonCode, fn?.name ?? companyFunctionId);
      const { id: googleCalendarId } = await createCalendar(summary);
      try {
        // A refused reader change is retried by the next `reconcileGoogleReaders` pass; a calendar
        // whose ACL could not be read or whose domain rule could not be pinned is not bound.
        await syncCalendarAcl(googleCalendarId, await getCalendarReaderEmails(companyFunctionId, cal.brandId, prisma));
      } catch (err) {
        // No binding will point at it: delete it rather than leave it with the org's default
        // sharing, out of every reconcile. Best effort: the sync's own error is the one reported.
        await deleteCalendar(googleCalendarId).catch(() => undefined);
        throw err;
      }

      return prisma.googleCalendarBinding.upsert({
        where: { seasonCalendarId_companyFunctionId: { seasonCalendarId: calendarId, companyFunctionId } },
        create: { seasonCalendarId: calendarId, companyFunctionId, googleCalendarId, isProvisioned: true },
        update: { googleCalendarId, isProvisioned: true },
      });
    },

    getMappings: (eventId) =>
      prisma.googleEventMapping.findMany({ where: { eventId } }),

    upsertMapping: async (mapping) => {
      await prisma.googleEventMapping.upsert({
        where: { eventId_companyFunctionId: { eventId: mapping.eventId, companyFunctionId: mapping.companyFunctionId } },
        create: { eventId: mapping.eventId, companyFunctionId: mapping.companyFunctionId, googleEventId: mapping.googleEventId, googleCalendarId: mapping.googleCalendarId, contentHash: mapping.contentHash, lastSyncedAt: new Date() },
        update: { googleEventId: mapping.googleEventId, googleCalendarId: mapping.googleCalendarId, contentHash: mapping.contentHash, lastSyncedAt: new Date() },
      });
    },

    deleteMapping: async (milestoneId, companyFunctionId) => {
      await prisma.googleEventMapping.deleteMany({
        where: { eventId: milestoneId, companyFunctionId },
      });
    },
  };
}

// ─── Sync operations ─────────────────────────────────────────────────────────

/**
 * Syncs a single calendar event to all bound Google Calendars. No-ops if the integration
 * is disabled or not configured.
 */
export async function syncOneMilestone(
  milestoneId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return;

  const m = await prisma.calendarEvent.findUniqueOrThrow({
    where: { id: milestoneId },
    include: { visibilities: { select: { functionId: true } }, planningGroup: { select: { name: true } } },
  });

  const ctx = await buildSyncContext(m.calendarId, prisma);
  await syncMilestone(mapMilestone(m), ctx);
  logger.info({ milestoneId }, 'Google Calendar sync completed');
}

/**
 * Deletes the Google Calendar copies of events already deleted from Luke — the mappings went with
 * them (cascade), so the caller reads `copies` before its delete (`deleteEvents`). Best effort: a
 * copy Google refuses to delete is logged and stays in Google. No-ops if the integration is disabled.
 */
export async function deleteGoogleCopies(
  copies: { googleCalendarId: string; googleEventId: string }[],
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  if (copies.length === 0) return;
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return;

  const results = await Promise.allSettled(copies.map(c => deleteEvent(c.googleCalendarId, c.googleEventId)));
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    logger.warn({ failed, total: copies.length }, 'Some Google Calendar copies of deleted events were not deleted');
  }
  logger.info({ count: copies.length - failed }, 'Google Calendar copies of deleted events removed');
}

/**
 * Deletes Google calendars Luke provisioned, once their bindings are gone (a purged season calendar).
 * Best effort, as `deleteGoogleCopies`: a calendar Google refuses to delete is logged by id and
 * stays. Runs with event sync off too (only credentials are needed): a purged calendar must not keep
 * its readers.
 */
export async function deleteGoogleCalendars(
  googleCalendarIds: string[],
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  if (googleCalendarIds.length === 0) return;
  const creds = await getConfiguredGoogleClient(prisma, { requireSyncEnabled: false });
  if (!creds) return;

  const results = await Promise.allSettled(googleCalendarIds.map(id => deleteCalendar(id)));
  const failedIds = googleCalendarIds.filter((_, i) => results[i].status === 'rejected');
  if (failedIds.length > 0) {
    logger.warn({ failedIds, total: googleCalendarIds.length }, 'Some provisioned Google calendars were not deleted');
  }
  logger.info({ count: googleCalendarIds.length - failedIds.length }, 'Provisioned Google calendars deleted');
}

/**
 * Re-syncs all milestones of a season calendar to Google Calendar. Errors per milestone
 * are caught individually so that a single failure does not abort the run.
 *
 * @returns Count of successfully synced milestones and count of errors.
 */
export async function reconcileCalendar(
  calendarId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<{ synced: number; errors: number }> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return { synced: 0, errors: 0 };

  const milestones = await prisma.calendarEvent.findMany({
    where: { calendarId },
    include: { visibilities: { select: { functionId: true } }, planningGroup: { select: { name: true } } },
  });

  if (milestones.length === 0) return { synced: 0, errors: 0 };

  const ctx = await buildSyncContext(calendarId, prisma);

  let synced = 0;
  let errors = 0;

  for (const m of milestones) {
    try {
      await syncMilestone(mapMilestone(m), ctx);
      synced++;
    } catch (err) {
      errors++;
      logger.error({ err, milestoneId: m.id }, 'Google Calendar reconcile error for milestone');
    }
  }

  logger.info({ calendarId, synced, errors }, 'Google Calendar reconciliation completed');
  return { synced, errors };
}

// ─── Reader reconcile ─────────────────────────────────────────────────────────

/** Bindings whose Google calendar answered 404, warned once per process: it will not come back. */
const missingCalendarsWarned = new Set<string>();

/** The last unmanaged-rule report, logged again only when it changes. */
let lastUnmanagedReport = '';

/**
 * Brings the ACL of every provisioned Google calendar back to what Luke grants (`syncCalendarAcl`):
 * readers from `getCalendarReaderEmails`, the domain rule read-only. Revokes whoever lost access in Luke (left a team, team lost the
 * brand or was deactivated, user deactivated or pending, address changed) and adds whoever gained
 * it. Each calendar is reconciled on its own: one failure does not stop the others. Rules Luke does
 * not manage are reported, aggregated per pass, never changed.
 *
 * Runs with event sync off too, as long as credentials exist.
 *
 * @returns Counts for the pass, or null when Google is not configured.
 */
export async function reconcileGoogleReaders(
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<{ calendars: number; added: number; removed: number; failed: number } | null> {
  const creds = await getConfiguredGoogleClient(prisma, { requireSyncEnabled: false });
  if (!creds) return null;

  const bindings = await prisma.googleCalendarBinding.findMany({
    where: { isProvisioned: true },
    select: { id: true, googleCalendarId: true, companyFunctionId: true, seasonCalendar: { select: { brandId: true } } },
  });

  // The same (function, brand) pair repeats across seasons: one query per pair.
  const readersByPair = new Map<string, Promise<string[]>>();
  const unmanaged = new Map<string, number>();
  let added = 0;
  let removed = 0;
  let failed = 0;

  for (const b of bindings) {
    const pair = `${b.companyFunctionId}:${b.seasonCalendar.brandId}`;
    let readers = readersByPair.get(pair);
    if (!readers) {
      readers = getCalendarReaderEmails(b.companyFunctionId, b.seasonCalendar.brandId, prisma);
      readersByPair.set(pair, readers);
    }

    try {
      const result = await syncCalendarAcl(b.googleCalendarId, await readers);
      added += result.added;
      removed += result.removed;
      if (result.errors.length > 0) {
        logger.warn(
          { bindingId: b.id, refused: result.errors.length, err: result.errors[0] },
          'Google refused some reader changes; retried on the next pass'
        );
      }
      for (const r of result.unmanaged) {
        const key = `${r.role}/${r.scopeType}`;
        unmanaged.set(key, (unmanaged.get(key) ?? 0) + 1);
      }
    } catch (err) {
      if (googleErrorStatus(err) === 404) {
        if (!missingCalendarsWarned.has(b.id)) {
          missingCalendarsWarned.add(b.id);
          logger.warn({ bindingId: b.id }, 'Google calendar of a binding no longer exists in Google');
        }
        continue;
      }
      failed++;
      logger.error({ err, bindingId: b.id }, 'Google Calendar reader reconcile failed for a calendar');
    }
  }

  const unmanagedRules = Object.fromEntries([...unmanaged].sort());
  const report = JSON.stringify(unmanagedRules);
  if (report !== lastUnmanagedReport && unmanaged.size > 0) {
    logger.warn(
      { unmanagedRules },
      'Google calendars carry ACL rules Luke does not manage; left unchanged'
    );
  }
  lastUnmanagedReport = report;

  logger.info({ calendars: bindings.length, added, removed, failed }, 'Google Calendar readers reconciled');
  return { calendars: bindings.length, added, removed, failed };
}

// ─── Subscription info ────────────────────────────────────────────────────────

/**
 * Lists the provisioned Google Calendars for a season calendar, one per company function,
 * for display in the "subscribe" panel. Only includes bindings that have actually been
 * provisioned (a Google Calendar was created for them).
 *
 * Scoped to the requesting user by the rule the Google readers follow (`getCalendarReaderEmails`):
 * admins see every section, anyone else a section only when one of their teams holds both its
 * function and the calendar's brand.
 */
export async function listGoogleCalendarBindings(
  calendarId: string,
  prisma: PrismaClient,
  userId: string,
  userRole?: Role
): Promise<{ companyFunctionId: string; functionName: string; googleCalendarId: string }[]> {
  const [{ functionBrands }, bindings] = await Promise.all([
    getUserAllowedIds(userId, prisma, userRole),
    prisma.googleCalendarBinding.findMany({
      where: { seasonCalendarId: calendarId, isProvisioned: true },
      include: { companyFunction: { select: { name: true } }, seasonCalendar: { select: { brandId: true } } },
    }),
  ]);
  return bindings
    .filter(b => functionBrands === null || functionBrands.get(b.companyFunctionId)?.has(b.seasonCalendar.brandId))
    .map(b => ({
      companyFunctionId: b.companyFunctionId,
      functionName: b.companyFunction.name,
      googleCalendarId: b.googleCalendarId,
    }));
}
