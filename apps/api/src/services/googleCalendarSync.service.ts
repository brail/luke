
import {
  createGoogleCalendarClient,
  syncMilestone,
  deleteEvent,
  buildCalendarSummary,
  createCalendar,
  deleteCalendar,
  syncCalendarAcl,
  googleErrorStatus,
  type CalendarConfig,
  type MilestoneForSync,
  type SyncContext,
} from '@luke/calendar';
import { planningGroupName, toErrorMessage, type Role } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getConfig, getConfigOrDefault } from '../lib/configManager.js';
import { notifyAdmins, notifyDeduped, SYSTEM_FAILURE_DEDUP_MS } from '../lib/notifications.js';

import { teamGrantsFunctionAndBrand } from './calendarAudience.service.js';
import { getUserAllowedIds } from './context.service.js';


interface SyncLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

// ─── Client factory ───────────────────────────────────────────────────────────

/** The stored credentials of one authentication mode; an absent key is `null`. */
export type StoredGoogleCredentials =
  | { authMode: 'oauth_user'; clientId: string | null; clientSecret: string | null; refreshToken: string | null }
  | { authMode: 'service_account'; serviceEmail: string | null; serviceKey: string | null; impersonateEmail: string | null };

/**
 * The client configuration for the stored Google settings, or null while a credential is missing.
 * The one mapping the sync and the settings connection test share (#223): a connection test that
 * passes authenticates as the sync does, impersonation included.
 */
export function toGoogleCalendarConfig(domain: string, stored: StoredGoogleCredentials): CalendarConfig | null {
  if (stored.authMode === 'oauth_user') {
    const { clientId, clientSecret, refreshToken } = stored;
    if (!clientId || !clientSecret || !refreshToken) return null;
    return { mode: 'oauth_user', clientId, clientSecret, refreshToken, workspaceDomain: domain };
  }
  const { serviceEmail, serviceKey, impersonateEmail } = stored;
  if (!serviceEmail || !serviceKey) return null;
  return {
    mode: 'service_account',
    serviceAccountEmail: serviceEmail,
    serviceAccountPrivateKey: serviceKey,
    workspaceDomain: domain,
    impersonateEmail: impersonateEmail || undefined,
  };
}

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

  let config: CalendarConfig | null;
  if (authMode === 'oauth_user') {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      getConfig(prisma, 'integrations.google.oauth.clientId'),
      getConfig(prisma, 'integrations.google.oauth.clientSecret'),
      getConfig(prisma, 'integrations.google.oauth.refreshToken'),
    ]);
    config = toGoogleCalendarConfig(domain, { authMode: 'oauth_user', clientId, clientSecret, refreshToken });
  } else {
    const [serviceEmail, serviceKey, impersonateEmail] = await Promise.all([
      getConfig(prisma, 'integrations.google.serviceEmail'),
      getConfig(prisma, 'integrations.google.serviceKey'),
      getConfig(prisma, 'integrations.google.impersonateEmail'),
    ]);
    config = toGoogleCalendarConfig(domain, { authMode: 'service_account', serviceEmail, serviceKey, impersonateEmail });
  }
  if (!config) return null;

  createGoogleCalendarClient(config);
  return { domain };
}

// ─── Sync outcome (#223) ──────────────────────────────────────────────────────

/**
 * The Google operations whose last outcome is kept, one `IntegrationStatus` row each: event sync
 * (single events and calendar reconcile), reader reconcile, deletes. Separate rows, so the reader
 * job's success every 10 minutes cannot hide a failing event sync.
 */
const GOOGLE_SYNC_OPERATIONS = ['events', 'readers', 'delete'] as const;
type GoogleSyncOperation = (typeof GOOGLE_SYNC_OPERATIONS)[number];

const statusKey = (operation: GoogleSyncOperation) => `google-calendar:${operation}` as const;

const FAILURE_TITLES: Record<GoogleSyncOperation, string> = {
  events: 'Google Calendar: sincronizzazione eventi non riuscita',
  readers: 'Google Calendar: lettori dei calendari non aggiornati',
  delete: 'Google Calendar: eliminazioni non riuscite',
};

const MAX_ERROR_LENGTH = 500;

/** What a pass did on Google: sent no request, succeeded, or failed (with its first error). */
type GoogleOutcome = 'none' | 'success' | { error: unknown };

function outcomeOf(failures: unknown[], calledGoogle: boolean): GoogleOutcome {
  if (failures.length > 0) return { error: failures[0] };
  return calledGoogle ? 'success' : 'none';
}

const rejectionsOf = (results: PromiseSettledResult<unknown>[]): unknown[] =>
  results.flatMap(r => (r.status === 'rejected' ? [r.reason] : []));

/**
 * Keeps the last outcome of `operation`: a success stores its time; a failure its time and message,
 * and tells the admins at most once per `SYSTEM_FAILURE_DEDUP_MS` and operation; 'none' stores
 * nothing. Never throws (`cleanUpAfterPurge` awaits the deletes): a failed write or notice is
 * logged, and the sync's own result stands.
 */
async function recordGoogleOutcome(
  prisma: PrismaClient,
  logger: SyncLogger,
  operation: GoogleSyncOperation,
  outcome: GoogleOutcome
): Promise<void> {
  if (outcome === 'none') return;
  const integration = statusKey(operation);
  const now = new Date();
  // The page and the notice show the same text.
  const message = outcome === 'success' ? null : toErrorMessage(outcome.error).slice(0, MAX_ERROR_LENGTH);
  const data = message === null ? { lastSuccessAt: now } : { lastErrorAt: now, lastError: message };
  try {
    await prisma.integrationStatus.upsert({ where: { integration }, create: { integration, ...data }, update: data });
  } catch (err) {
    logger.error({ err, integration }, 'Google Calendar: sync outcome not recorded');
  }
  if (message === null) return;

  await notifyDeduped(prisma, `google-sync:failure:${operation}`, SYSTEM_FAILURE_DEDUP_MS, () => notifyAdmins(prisma, {
    category: 'SYSTEM',
    title: FAILURE_TITLES[operation],
    message,
    link: '/settings/google',
    data: { type: 'google_sync_failure' },
  })).catch(err => logger.error({ err, operation }, 'Google Calendar: admins not told of a sync failure'));
}

/** Runs `work`; a throw is recorded as a failure of `operation`, then rethrown. */
async function failureRecorded<T>(
  prisma: PrismaClient,
  logger: SyncLogger,
  operation: GoogleSyncOperation,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    await recordGoogleOutcome(prisma, logger, operation, { error: err });
    throw err;
  }
}

/**
 * `getConfiguredGoogleClient` for `operation`. Only its `null` means "not configured": a
 * configuration it cannot read (an undecryptable credential) fails the operation.
 */
const googleClientFor = (
  prisma: PrismaClient,
  logger: SyncLogger,
  operation: GoogleSyncOperation,
  options?: { requireSyncEnabled?: boolean }
) => failureRecorded(prisma, logger, operation, () => getConfiguredGoogleClient(prisma, options));

/**
 * The last outcome of each Google operation that has one, in a fixed order, for the settings page.
 * An operation that has neither failed nor sent Google a request has no entry.
 */
export async function getGoogleSyncStatus(prisma: PrismaClient) {
  const rows = await prisma.integrationStatus.findMany({
    where: { integration: { in: GOOGLE_SYNC_OPERATIONS.map(statusKey) } },
  });
  return GOOGLE_SYNC_OPERATIONS.flatMap(operation => {
    const row = rows.find(r => r.integration === statusKey(operation));
    return row ? [{ operation, lastSuccessAt: row.lastSuccessAt, lastErrorAt: row.lastErrorAt, lastError: row.lastError }] : [];
  });
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
 * Syncs a single calendar event to all bound Google Calendars and records the outcome. No-ops if
 * the integration is disabled or not configured, or the event no longer exists.
 */
export async function syncOneMilestone(
  milestoneId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  if (!(await googleClientFor(prisma, logger, 'events'))) return;

  const m = await prisma.calendarEvent.findUnique({
    where: { id: milestoneId },
    include: { visibilities: { select: { functionId: true } }, planningGroup: { select: { name: true } } },
  });
  // Deleted since the change that started this sync: nothing left to sync.
  if (!m) return;

  const ctx = await buildSyncContext(m.calendarId, prisma);
  const calledGoogle = await failureRecorded(prisma, logger, 'events', () => syncMilestone(mapMilestone(m), ctx));
  await recordGoogleOutcome(prisma, logger, 'events', calledGoogle ? 'success' : 'none');
  logger.info({ milestoneId }, 'Google Calendar sync completed');
}

/**
 * Deletes the Google Calendar copies of events already deleted from Luke — the mappings went with
 * them (cascade), so the caller reads `copies` before its delete (`deleteEvents`). Best effort: a
 * copy Google refuses to delete is logged, recorded and stays in Google. No-ops if the integration
 * is disabled.
 */
export async function deleteGoogleCopies(
  copies: { googleCalendarId: string; googleEventId: string }[],
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  if (copies.length === 0) return;
  if (!(await googleClientFor(prisma, logger, 'delete'))) return;

  const results = await Promise.allSettled(
    copies.map(c => deleteEvent(c.googleCalendarId, c.googleEventId))
  );
  const failures = rejectionsOf(results);
  if (failures.length > 0) {
    logger.warn({ failed: failures.length, total: copies.length }, 'Some Google Calendar copies of deleted events were not deleted');
  }
  logger.info({ count: copies.length - failures.length }, 'Google Calendar copies of deleted events removed');
  await recordGoogleOutcome(prisma, logger, 'delete', outcomeOf(failures, true));
}

/**
 * Deletes Google calendars Luke provisioned, once their bindings are gone (a purged season calendar).
 * Best effort, as `deleteGoogleCopies`: a calendar Google refuses to delete is logged by id,
 * recorded and stays. Runs with event sync off too (only credentials are needed): a purged calendar must not keep
 * its readers.
 */
export async function deleteGoogleCalendars(
  googleCalendarIds: string[],
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  if (googleCalendarIds.length === 0) return;
  if (!(await googleClientFor(prisma, logger, 'delete', { requireSyncEnabled: false }))) return;

  const results = await Promise.allSettled(googleCalendarIds.map(id => deleteCalendar(id)));
  const failedIds = googleCalendarIds.filter((_, i) => results[i].status === 'rejected');
  if (failedIds.length > 0) {
    logger.warn({ failedIds, total: googleCalendarIds.length }, 'Some provisioned Google calendars were not deleted');
  }
  logger.info({ count: googleCalendarIds.length - failedIds.length }, 'Provisioned Google calendars deleted');
  await recordGoogleOutcome(prisma, logger, 'delete', outcomeOf(rejectionsOf(results), true));
}

/**
 * Re-syncs all milestones of a season calendar to Google Calendar. Errors per milestone
 * are caught individually so that a single failure does not abort the run; any of them makes the
 * recorded outcome a failure.
 *
 * @returns Count of successfully synced milestones and count of errors.
 */
export async function reconcileCalendar(
  calendarId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<{ synced: number; errors: number }> {
  const creds = await googleClientFor(prisma, logger, 'events');
  if (!creds) return { synced: 0, errors: 0 };

  const milestones = await prisma.calendarEvent.findMany({
    where: { calendarId },
    include: { visibilities: { select: { functionId: true } }, planningGroup: { select: { name: true } } },
  });

  if (milestones.length === 0) return { synced: 0, errors: 0 };

  const ctx = await buildSyncContext(calendarId, prisma);

  let synced = 0;
  let calledGoogle = false;
  const failures: unknown[] = [];

  for (const m of milestones) {
    try {
      if (await syncMilestone(mapMilestone(m), ctx)) calledGoogle = true;
      synced++;
    } catch (err) {
      failures.push(err);
      logger.error({ err, milestoneId: m.id }, 'Google Calendar reconcile error for milestone');
    }
  }

  const errors = failures.length;
  logger.info({ calendarId, synced, errors }, 'Google Calendar reconciliation completed');
  await recordGoogleOutcome(prisma, logger, 'events', outcomeOf(failures, calledGoogle));
  return { synced, errors };
}

// ─── Reader reconcile ─────────────────────────────────────────────────────────

/** Bindings whose Google calendar answered 404, warned once per process: it will not come back. */
const missingCalendarsWarned = new Set<string>();

/** The last unmanaged-rule report, logged again only when it changes. */
let lastUnmanagedReport = '';

/**
 * Addresses inserted per binding on the previous pass. One inserted again means Google did not keep
 * the reader under it — an alias Google no longer resolves (#243): the share email and the access
 * flap would repeat every pass. Per process: a restart needs two passes to see it again.
 */
const insertedLastPass = new Map<string, Set<string>>();

/**
 * Brings the ACL of every provisioned Google calendar back to what Luke grants (`syncCalendarAcl`):
 * readers from `getCalendarReaderEmails`, the domain rule read-only. Revokes whoever lost access in Luke (left a team, team lost the
 * brand or was deactivated, user deactivated or pending, address changed) and adds whoever gained
 * it. Each calendar is reconciled on its own: one failure does not stop the others. Rules Luke does
 * not manage are reported, aggregated per pass, never changed.
 *
 * Runs with event sync off too, as long as credentials exist. A failed calendar or a refused reader
 * change makes the recorded outcome a failure; a pass that read no ACL records nothing.
 *
 * @returns Counts for the pass, or null when Google is not configured.
 */
export async function reconcileGoogleReaders(
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<{ calendars: number; added: number; removed: number; failed: number } | null> {
  const creds = await googleClientFor(prisma, logger, 'readers', { requireSyncEnabled: false });
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
  /** Whether Google returned a calendar's ACL: a 404 calendar is no read. */
  let readAcl = false;
  /** Refused reader changes and failed calendars, for the recorded outcome. */
  const failures: unknown[] = [];

  for (const b of bindings) {
    const pair = `${b.companyFunctionId}:${b.seasonCalendar.brandId}`;
    let readers = readersByPair.get(pair);
    if (!readers) {
      readers = getCalendarReaderEmails(b.companyFunctionId, b.seasonCalendar.brandId, prisma);
      readersByPair.set(pair, readers);
    }

    try {
      const result = await syncCalendarAcl(b.googleCalendarId, await readers);
      readAcl = true;
      added += result.added;
      removed += result.removed;
      if (result.errors.length > 0) {
        failures.push(result.errors[0]);
        logger.warn(
          { bindingId: b.id, unsettled: result.errors.length, err: result.errors[0] },
          'Some readers were refused by Google or could not be resolved; retried on the next pass'
        );
      }
      const previous = insertedLastPass.get(b.id);
      const reinserted = result.inserted.filter(address => previous?.has(address)).length;
      if (result.inserted.length > 0) insertedLastPass.set(b.id, new Set(result.inserted));
      else insertedLastPass.delete(b.id);
      if (reinserted > 0) {
        failures.push(new Error('Google did not keep readers inserted on the previous pass'));
        logger.warn(
          { bindingId: b.id, reinserted },
          'Google did not keep readers under the addresses Luke inserted; alias not resolved?'
        );
      }
      for (const r of result.unmanaged) {
        const key = `${r.role}/${r.scopeType}`;
        unmanaged.set(key, (unmanaged.get(key) ?? 0) + 1);
      }
    } catch (err) {
      // What this pass inserted is unknown: the next pass has nothing to compare against.
      insertedLastPass.delete(b.id);
      if (googleErrorStatus(err) === 404) {
        if (!missingCalendarsWarned.has(b.id)) {
          missingCalendarsWarned.add(b.id);
          logger.warn({ bindingId: b.id }, 'Google calendar of a binding no longer exists in Google');
        }
        continue;
      }
      failed++;
      failures.push(err);
      logger.error({ err, bindingId: b.id }, 'Google Calendar reader reconcile failed for a calendar');
    }
  }

  const current = new Set(bindings.map(b => b.id));
  for (const id of insertedLastPass.keys()) if (!current.has(id)) insertedLastPass.delete(id);

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
  await recordGoogleOutcome(prisma, logger, 'readers', outcomeOf(failures, readAcl));
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
