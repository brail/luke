/**
 * Daily calendar digest email scheduler.
 *
 * Each recipient gets their digest at the first tick at or after 07:00 in their own zone
 * (`resolveUserTimeZone`), covering their "yesterday" there: AuditLog changes to CalendarEvents,
 * collapsed so multiple touches to the same event become a single net-change entry
 * (created+deleted in the same period cancels out; repeated edits show one diff from the period's
 * first old value to the final live value), one email per calendar per user.
 *
 * Every email is a `CalendarDigestDelivery` row keyed by (user, local send date, calendar). Each
 * state change is one conditional statement the caller owns only if it affected that row: a first
 * claim inserts it if absent, a re-claim takes a FAILED row after its backoff or a SENDING row
 * whose lease expired, and only the claim's holder records SENT or FAILED. At most three claims per
 * email; one whose attempts are spent, whose send day ended, or that a successful rebuild no longer
 * produces (recipient deactivated, opted out, lost access) becomes ABANDONED and is logged.
 * The guarantee is bounded retry — neither at-least-once nor exactly-once: SMTP accepting a message
 * whose reply is lost, a crash before SENT is written, or a lease outlived by a slow send can
 * duplicate an email; exhausted attempts, the end of the send day, or downtime can omit one.
 * Missed days are never back-filled.
 *
 * Recipients for created/updated events: `resolveEventAudience()` — brand-scoped, per-function
 * or per-user grant, admins included only via their own team membership (no automatic fan-out).
 * Recipients for deleted events: the snapshot in `AuditLog.metadata.visibleUserIds` (captured by
 * the pre-fix resolver, so wider than it should be) re-filtered at read time through
 * `resolveBrandAccess` — the invariant holds even against audit rows written before this fix.
 *
 * If SMTP is not configured the tick logs a warning and claims nothing.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';

import {
  addCalendarDays,
  calendarDateIn,
  calendarDateOf,
  CATEGORY_LEVEL_EVENT_KEY,
  eventCalendarDays,
  formatCalendarDate,
  formatDateWithTimezone,
  fullName,
  instantAt,
  startOfDayIn,
  utcMidnightOf,
  type CalendarDate,
} from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

import { hasBrandAccess, resolveBrandAccess, resolveEventAudience } from '../services/calendarAudience.service';

import { isRedactedValue } from './auditLog';
import { getConfigOrDefault } from './configManager';
import { escapeHtml, getSmtpConfig, sendBulkEmail, sendEmail } from './mailer';
import { guardMaintenance } from './maintenanceMode';
import { withSchedulerLock } from './schedulerLock';
import { groupByTimeZone, resolveUserTimeZone } from './userTimeZone';

import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 15 * 60 * 1000;
/** Wall time, in each recipient's zone, from which their digest is due. */
const DIGEST_TIME = '07:00';
/** Longer than one `sendEmail` can take with nodemailer's default timeouts (about 38 min). */
const LEASE_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
/** A failed email is re-claimable this long × the attempts made so far after the failure. */
const RETRY_BACKOFF_MS = 30 * 60 * 1000;
/**
 * The `changedFields` label an update row carried for `allDay` before update rows recorded
 * `oldAllDay` (2026-09-30). Only those older rows are read with it — frozen audit data, so it stays
 * as written even if the label the router shows changes.
 */
const LEGACY_ALL_DAY_LABEL = 'Giornata intera';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DigestEntry {
  title: string;
  actorName: string;
  time: string;
  dateLabel?: string;
  dateChangeLabel?: string;
  statusChangeLabel?: string;
  otherFieldsLabel?: string;
}

const DAY_SHORT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const DAY_MEDIUM: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const DAY_LONG: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
const TIME_OF_DAY: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

function formatEventDate(startAt: Date, endAt: Date | null, allDay: boolean, timeZone: string): string {
  const [first, last] = eventCalendarDays(startAt, endAt, allDay, timeZone);
  if (first !== last) return `${formatCalendarDate(first, DAY_SHORT)}–${formatCalendarDate(last, DAY_MEDIUM)}`;
  if (allDay) return formatCalendarDate(first, DAY_MEDIUM);
  return `${formatCalendarDate(first, DAY_MEDIUM)}, ${formatDateWithTimezone(startAt, timeZone, TIME_OF_DAY)}`;
}

/**
 * Whether an event was all-day before the change recorded in `c`. A reschedule records `oldAllDay`
 * when it changed the kind and nothing when it did not, so the event's current kind stands in. An
 * update row records `oldAllDay` too; one written before it did stores the new `allDay` only, and the
 * old value was the other kind when that update listed `allDay` among its changed fields.
 */
function oldAllDayOf(c: { action: string; meta: Record<string, unknown> }, currentAllDay: boolean): boolean {
  if (typeof c.meta.oldAllDay === 'boolean') return c.meta.oldAllDay;
  if (c.action === 'CALENDAR_EVENT_RESCHEDULE') return currentAllDay;
  const changedFields = Array.isArray(c.meta.changedFields) ? (c.meta.changedFields as string[]) : [];
  const allDayAtChange = c.meta.allDay === true;
  return changedFields.includes(LEGACY_ALL_DAY_LABEL) ? !allDayAtChange : allDayAtChange;
}

/**
 * A date read from audit metadata, or `null` when it is missing, redacted, not a date or outside
 * 1900–9999 — one malformed row must not fail the whole digest (the calendar-date helpers throw on
 * an invalid date and outside those years, and a record keeps whatever an older schema accepted).
 */
function metaDate(value: unknown): Date | null {
  if (typeof value !== 'string' || isRedactedValue(value)) return null;
  const date = new Date(value);
  const year = date.getUTCFullYear();
  return Number.isNaN(year) || year < 1900 || year > 9999 ? null : date;
}

/** Builds an event date label from raw (possibly redacted/missing) audit metadata values. */
function dateLabelFromMeta(startAt: unknown, endAt: unknown, allDay: unknown, timeZone: string): string | undefined {
  const start = metaDate(startAt);
  if (!start) return undefined;
  return formatEventDate(start, metaDate(endAt), allDay === true, timeZone);
}

interface UserDigest {
  created: DigestEntry[];
  updated: DigestEntry[];
  deleted: DigestEntry[];
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function entryRow(e: DigestEntry): string {
  // Every field carries user-entered text — titles, names, reasons, field values — so each is
  // escaped where it enters the HTML.
  const extraLines = [e.dateLabel, e.dateChangeLabel, e.statusChangeLabel, e.otherFieldsLabel]
    .filter((l): l is string => !!l)
    .map(l => `<div style="margin-top:2px;font-size:12px;color:#94a3b8">${escapeHtml(l)}</div>`)
    .join('');
  return `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b">${escapeHtml(e.title)}${extraLines}</td><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:right;white-space:nowrap">${escapeHtml(e.actorName)} · ${escapeHtml(e.time)}</td></tr>`;
}

function section(heading: string, color: string, entries: DigestEntry[]): string {
  if (entries.length === 0) return '';
  return `
    <p style="margin:24px 0 8px;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${color}">${heading} (${entries.length})</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9">
      ${entries.map(entryRow).join('')}
    </table>`;
}

function generateDigestHtml(dateLabel: string, digest: UserDigest, calendarUrl: string, calendarLabel: string, timeZone: string): string {
  const year = new Date().getFullYear();
  const body = [
    section('Nuovi eventi', '#16a34a', digest.created),
    section('Modificati', '#2563eb', digest.updated),
    section('Eliminati', '#dc2626', digest.deleted),
  ].join('');

  const total = digest.created.length + digest.updated.length + digest.deleted.length;

  return `<!doctype html><html lang="it"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Recap calendario</title></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f9fafb"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><tr><td style="padding:32px 40px 24px;border-bottom:1px solid #e5e7eb"><h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e293b">Recap calendario</h1><p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#475569">${escapeHtml(calendarLabel)}</p><p style="margin:0;font-size:14px;color:#64748b">${escapeHtml(dateLabel)} · ${total} modific${total === 1 ? 'a' : 'he'}</p><p style="margin:2px 0 0;font-size:12px;color:#94a3b8">Orari in ${escapeHtml(timeZone)}</p></td></tr><tr><td style="padding:24px 40px 32px">${body}<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px"><tr><td align="center"><a href="${escapeHtml(calendarUrl)}" style="display:inline-block;padding:12px 28px;background-color:#1e293b;color:#f8fafc;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600">Vai al calendario</a></td></tr></table><p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Per non ricevere questi aggiornamenti, disabilitali nelle <strong>preferenze di notifica → Calendario</strong>.</p></td></tr><tr><td style="padding:20px 40px;background-color:#f8fafc;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px"><p style="margin:0;font-size:12px;text-align:center;color:#94a3b8">© ${year} Luke. Tutti i diritti riservati.</p></td></tr></table></td></tr></table></body></html>`;
}

function generateDigestText(dateLabel: string, digest: UserDigest, calendarLabel: string, timeZone: string): string {
  const lines: string[] = [`Recap calendario — ${calendarLabel} — ${dateLabel}`, `Orari in ${timeZone}`, ''];

  const entryLines = (e: DigestEntry): string[] => {
    const out = [`• ${e.title}  (${e.actorName}, ${e.time})`];
    for (const extra of [e.dateLabel, e.dateChangeLabel, e.statusChangeLabel, e.otherFieldsLabel]) {
      if (extra) out.push(`   ${extra}`);
    }
    return out;
  };

  if (digest.created.length > 0) {
    lines.push(`NUOVI EVENTI (${digest.created.length})`);
    digest.created.forEach(e => lines.push(...entryLines(e)));
    lines.push('');
  }
  if (digest.updated.length > 0) {
    lines.push(`MODIFICATI (${digest.updated.length})`);
    digest.updated.forEach(e => lines.push(...entryLines(e)));
    lines.push('');
  }
  if (digest.deleted.length > 0) {
    lines.push(`ELIMINATI (${digest.deleted.length})`);
    digest.deleted.forEach(e => lines.push(...entryLines(e)));
    lines.push('');
  }

  lines.push('Per disabilitare questi aggiornamenti: preferenze di notifica → Calendario.');
  return lines.join('\n');
}


// ─── Core logic ──────────────────────────────────────────────────────────────

export interface DigestDateRange {
  start: Date;
  end: Date;
}

export interface DigestBuildOptions {
  /** The changes covered: AuditLog rows created in `[start, end)`. */
  range: DigestDateRange;
  /** IANA zone every date and time in the email is written in. */
  timeZone: string;
  /**
   * Manual "send to me": only this user's slice, bypassing relevance and their category opt-out.
   * Scheduled runs never set it.
   */
  onlyUserId?: string;
  /** Scheduled runs: keep only these (user, calendar) pairs — it narrows the audience, never widens it. */
  include?: (userId: string, calendarId: string) => boolean;
}

// One email per calendar per user — content varies per (calendar, user) pair, so each task
// carries its own fully-rendered subject/html/text rather than being a plain recipient list.
export interface EmailTask { userId: string; calendarId: string; email: string; subject: string; html: string; text: string }

/**
 * Adds `onlyUserId` to `recipients` when the manual "send to me" trigger is bypassing
 * `P_relevance` (function/grant visibility) for a user who wouldn't otherwise be in the
 * audience — e.g. an admin belonging to no team. `P_access` (brand) still applies: bypassing it
 * too would let the test button send someone a digest for a brand `listMilestones` won't show
 * them. `onlyUserAccess === undefined` means the user is inactive/pending — no bypass.
 */
function addManualBypassRecipient(
  recipients: Set<string>,
  brandId: string | null | undefined,
  onlyUserId: string | undefined,
  onlyUserAccess: Set<string> | null | undefined,
): void {
  if (!onlyUserId || !brandId) return;
  if (hasBrandAccess(onlyUserAccess, brandId)) recipients.add(onlyUserId);
}

/**
 * Builds the fully-rendered email tasks for a digest run, without sending them — the seam that
 * makes recipients testable without mocking SMTP. Returns an empty array when there's nothing to
 * send (no changes in range, or nothing survives the recipient/preference filtering). Throws when
 * a lookup fails: an empty audience must never stand in for one that could not be read.
 */
export async function buildDigestTasks(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  options: DigestBuildOptions,
): Promise<{ tasks: EmailTask[]; calendarCount: number }> {
  const { range, timeZone, onlyUserId, include } = options;

  // First, so an unusable zone fails the build before anything else is read.
  const firstDay = calendarDateIn(range.start, timeZone);
  const lastDay = calendarDateIn(new Date(range.end.getTime() - 1), timeZone);
  const dateLabel = firstDay === lastDay
    ? formatCalendarDate(firstDay, DAY_LONG)
    : `dal ${formatCalendarDate(firstDay, DAY_LONG)} al ${formatCalendarDate(lastDay, DAY_LONG)}`;

  const logs = await prisma.auditLog.findMany({
    where: {
      targetType: { in: ['CalendarEvent', 'CalendarMilestone'] },
      action: { in: ['CALENDAR_EVENT_CREATE', 'CALENDAR_EVENT_UPDATE', 'CALENDAR_EVENT_RESCHEDULE', 'CALENDAR_EVENT_CANCEL', 'CALENDAR_MILESTONE_DELETE', 'CALENDAR_EVENT_DELETE'] },
      result: 'SUCCESS',
      createdAt: { gte: range.start, lt: range.end },
    },
    include: { actor: { select: { id: true, firstName: true, lastName: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (logs.length === 0) {
    log.debug({ timeZone, start: range.start }, 'Calendar digest: no changes in range');
    return { tasks: [], calendarCount: 0 };
  }

  const DELETE_ACTIONS = new Set(['CALENDAR_EVENT_DELETE', 'CALENDAR_MILESTONE_DELETE']);

  // ─── Normalize + group audit logs by event, so multiple touches in the same
  // period collapse into a single net-change entry (noise reduction) ─────────
  interface Change {
    eventId: string;
    action: string;
    actorId: string | null;
    actorName: string;
    time: string;
    meta: Record<string, unknown>;
  }

  const changes: Change[] = [];
  for (const entry of logs) {
    const actor = entry.actor;
    const actorName = actor ? fullName(actor) : 'Sistema';
    const time = formatDateWithTimezone(entry.createdAt, timeZone, TIME_OF_DAY);
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;

    if (entry.action === 'CALENDAR_EVENT_DELETE' && Array.isArray(meta.snapshots)) {
      const snapshots = meta.snapshots as Array<{ id?: string; title?: string; calendarId?: string; visibleUserIds?: string[]; startAt?: string; endAt?: string | null; allDay?: boolean }>;
      for (const snap of snapshots) {
        if (typeof snap.id !== 'string') continue;
        changes.push({
          eventId: snap.id, action: entry.action, actorId: entry.actorId, actorName, time,
          meta: { title: snap.title, calendarId: snap.calendarId, visibleUserIds: snap.visibleUserIds, startAt: snap.startAt, endAt: snap.endAt, allDay: snap.allDay },
        });
      }
      continue;
    }

    if (!entry.targetId) continue;
    changes.push({ eventId: entry.targetId, action: entry.action, actorId: entry.actorId, actorName, time, meta });
  }

  const byEvent = new Map<string, Change[]>();
  for (const c of changes) {
    if (!byEvent.has(c.eventId)) byEvent.set(c.eventId, []);
    byEvent.get(c.eventId)!.push(c);
  }

  // Single pass: an event is "net deleted" if its most recent touch in the period was a delete —
  // split live vs. deleted here, and for the deleted branch also gather what the batched brand
  // lookups below need (calendar ids, and the audit snapshot's candidate recipients).
  const liveTargetIds: string[] = [];
  const deletedCalendarIds = new Set<string>();
  const brandAccessCandidateIds = new Set<string>(onlyUserId ? [onlyUserId] : []);
  for (const [eventId, chgs] of byEvent) {
    const last = chgs[chgs.length - 1];
    if (!DELETE_ACTIONS.has(last.action)) {
      liveTargetIds.push(eventId);
      continue;
    }
    if (chgs.some(c => c.action === 'CALENDAR_EVENT_CREATE')) continue; // net-zero, skipped below too
    const meta = last.meta;
    const calendarId = !isRedactedValue(meta.calendarId) && typeof meta.calendarId === 'string' ? meta.calendarId : null;
    if (calendarId) deletedCalendarIds.add(calendarId);
    const extraIds = Array.isArray(meta.visibleUserIds) ? (meta.visibleUserIds as string[]) : [];
    for (const id of extraIds) brandAccessCandidateIds.add(id);
  }

  // Parallel pre-fetches
  const [visibilityMap, liveEvents, deletedCalendarBrands, brandAccessMap] = await Promise.all([
    resolveEventAudience(liveTargetIds, prisma),
    liveTargetIds.length > 0
      ? prisma.calendarEvent.findMany({
          where: { id: { in: liveTargetIds } },
          select: { id: true, title: true, calendarId: true, startAt: true, endAt: true, allDay: true, cancelledAt: true, calendar: { select: { brandId: true } } },
        })
      : Promise.resolve([]),
    deletedCalendarIds.size > 0
      ? prisma.seasonCalendar.findMany({ where: { id: { in: [...deletedCalendarIds] } }, select: { id: true, brandId: true } })
      : Promise.resolve([]),
    // The deleted-branch snapshot (AuditLog.metadata.visibleUserIds) was captured by the
    // pre-fix resolver and may be wider than the current brand-scoped audience — this map
    // re-filters it below. Also covers `onlyUserId` for the manual-bypass check.
    resolveBrandAccess([...brandAccessCandidateIds], prisma),
  ]);
  const liveEventMap = new Map(liveEvents.map(e => [e.id, e]));
  const deletedCalendarBrandMap = new Map(deletedCalendarBrands.map(c => [c.id, c.brandId]));
  const onlyUserAccess = onlyUserId ? brandAccessMap.get(onlyUserId) : undefined;

  // Build per-calendar per-user digest map: calendarId → userId → UserDigest
  const calendarDigests = new Map<string, Map<string, UserDigest>>();

  const addEntry = (calId: string, uid: string, bucket: keyof UserDigest, entry: DigestEntry) => {
    if (include && !include(uid, calId)) return;
    if (!calendarDigests.has(calId)) calendarDigests.set(calId, new Map());
    const calMap = calendarDigests.get(calId)!;
    if (!calMap.has(uid)) calMap.set(uid, { created: [], updated: [], deleted: [] });
    calMap.get(uid)![bucket].push(entry);
  };

  for (const [eventId, chgs] of byEvent) {
    const last = chgs[chgs.length - 1];
    const isNetDeleted = DELETE_ACTIONS.has(last.action);
    const hasCreate = chgs.some(c => c.action === 'CALENDAR_EVENT_CREATE');

    // Created then deleted within the same period: net zero, drop entirely.
    if (isNetDeleted && hasCreate) continue;

    if (isNetDeleted) {
      const meta = last.meta;
      const title = (!isRedactedValue(meta.title) && typeof meta.title === 'string' ? meta.title : null) ?? '(evento)';
      const calendarId = !isRedactedValue(meta.calendarId) && typeof meta.calendarId === 'string' ? meta.calendarId : null;
      if (!calendarId) continue;
      const brandId = deletedCalendarBrandMap.get(calendarId);
      const dateLabel = dateLabelFromMeta(meta.startAt, meta.endAt, meta.allDay, timeZone);
      const extraIds = Array.isArray(meta.visibleUserIds) ? (meta.visibleUserIds as string[]) : [];

      const recipientIds = new Set<string>();
      if (brandId) {
        for (const uid of extraIds) {
          if (hasBrandAccess(brandAccessMap.get(uid), brandId)) recipientIds.add(uid);
        }
      }
      addManualBypassRecipient(recipientIds, brandId, onlyUserId, onlyUserAccess);

      for (const uid of recipientIds) {
        addEntry(calendarId, uid, 'deleted', { title, actorName: last.actorName, time: last.time, dateLabel });
      }
      continue;
    }

    // Event still exists — resolve calendarId/title/date from the LIVE row (final state)
    const liveEvent = liveEventMap.get(eventId);
    const metaCalendarId = chgs.map(c => c.meta.calendarId).find((v): v is string => typeof v === 'string' && !isRedactedValue(v));
    const calendarId = liveEvent?.calendarId ?? metaCalendarId ?? null;
    if (!calendarId) continue;
    const metaTitle = chgs.map(c => c.meta.title).find((v): v is string => typeof v === 'string' && !isRedactedValue(v));
    const title = liveEvent?.title ?? metaTitle ?? eventId;
    const dateLabel = liveEvent ? formatEventDate(liveEvent.startAt, liveEvent.endAt, liveEvent.allDay, timeZone) : undefined;
    const recipientIds = new Set(visibilityMap.get(eventId) ?? []);
    addManualBypassRecipient(recipientIds, liveEvent?.calendar.brandId, onlyUserId, onlyUserAccess);

    if (hasCreate) {
      // Brand-new event this period — final state is all that matters, no diff needed.
      for (const uid of recipientIds) {
        addEntry(calendarId, uid, 'created', { title, actorName: last.actorName, time: last.time, dateLabel });
      }
      continue;
    }

    // Pure update(s)/cancellation — collapse into a single net diff over the whole period.
    const updateChanges = chgs.filter(c => c.action === 'CALENDAR_EVENT_UPDATE');
    const cancelChanges = chgs.filter(c => c.action === 'CALENDAR_EVENT_CANCEL');
    // A motivated reschedule moves the dates like an update does, and records the old ones the same way.
    const dateChanges = chgs.filter(c => c.action === 'CALENDAR_EVENT_UPDATE' || c.action === 'CALENDAR_EVENT_RESCHEDULE');

    let dateChangeLabel: string | undefined;
    let firstDateChange: Change | undefined;
    let oldStart: Date | null = null;
    for (const c of dateChanges) {
      oldStart = metaDate(c.meta.oldStartAt);
      if (oldStart) {
        firstDateChange = c;
        break;
      }
    }
    if (firstDateChange && oldStart && liveEvent) {
      const oldAllDay = oldAllDayOf(firstDateChange, liveEvent.allDay);
      const oldEnd = metaDate(firstDateChange.meta.oldEndAt);
      const [oldFirst] = eventCalendarDays(oldStart, oldEnd, oldAllDay, timeZone);
      const [newFirst] = eventCalendarDays(liveEvent.startAt, liveEvent.endAt, liveEvent.allDay, timeZone);

      // All-day values compare as dates, timed ones as instants.
      const startMoved = oldAllDay !== liveEvent.allDay
        || (liveEvent.allDay ? oldFirst !== newFirst : oldStart.getTime() !== liveEvent.startAt.getTime());
      if (startMoved) {
        const later = newFirst === oldFirst ? liveEvent.startAt.getTime() > oldStart.getTime() : newFirst > oldFirst;
        dateChangeLabel = `${later ? 'Posticipato' : 'Anticipato'}: ${formatCalendarDate(oldFirst, DAY_SHORT)} → ${formatCalendarDate(newFirst, DAY_SHORT)}`;
      } else if (liveEvent.allDay) {
        // No end means a one-day event, so only the last day counts.
        const oldLast = calendarDateOf(oldEnd ?? oldStart);
        const newLast = calendarDateOf(liveEvent.endAt ?? liveEvent.startAt);
        if (oldLast !== newLast) dateChangeLabel = `Durata modificata: fine ${formatCalendarDate(oldLast, DAY_SHORT)} → ${formatCalendarDate(newLast, DAY_SHORT)}`;
      } else if ((oldEnd?.getTime() ?? null) !== (liveEvent.endAt?.getTime() ?? null)) {
        const formatEnd = (end: Date | null) => end
          ? `${formatCalendarDate(calendarDateIn(end, timeZone), DAY_SHORT)}, ${formatDateWithTimezone(end, timeZone, TIME_OF_DAY)}`
          : '—';
        dateChangeLabel = `Durata modificata: fine ${formatEnd(oldEnd)} → ${formatEnd(liveEvent.endAt)}`;
      }
    }

    // A reschedule carries a mandatory reason: it goes with the date change it explains.
    const rescheduleReason = dateChanges
      .filter(c => c.action === 'CALENDAR_EVENT_RESCHEDULE')
      .map(c => c.meta.reason)
      .reverse()
      .find((r): r is string => typeof r === 'string' && !isRedactedValue(r));
    if (dateChangeLabel && rescheduleReason) dateChangeLabel += ` — motivo: ${rescheduleReason}`;

    // A cancellation is terminal — surface it (with its reason) as the event's status line.
    let statusChangeLabel: string | undefined;
    const cancelChange = cancelChanges.find(c => typeof c.meta.reason === 'string');
    if (cancelChange) {
      statusChangeLabel = `Annullato: ${cancelChange.meta.reason as string}`;
    }

    const otherFieldsSet = new Set<string>();
    for (const c of updateChanges) {
      if (Array.isArray(c.meta.changedFields)) (c.meta.changedFields as string[]).forEach(f => otherFieldsSet.add(f));
    }
    const otherFieldsLabel = otherFieldsSet.size > 0 ? `Altri campi: ${[...otherFieldsSet].join(', ')}` : undefined;

    // Net-zero guard: e.g. moved 3 times back to the original date — nothing actually changed, drop the noise.
    if (!dateChangeLabel && !statusChangeLabel && !otherFieldsLabel) continue;

    for (const uid of recipientIds) {
      addEntry(calendarId, uid, 'updated', { title, actorName: last.actorName, time: last.time, dateLabel, dateChangeLabel, statusChangeLabel, otherFieldsLabel });
    }
  }

  if (calendarDigests.size === 0) return { tasks: [], calendarCount: 0 };

  // Fetch calendar labels + user emails + preferences + baseUrl in parallel
  const allCalendarIds = Array.from(calendarDigests.keys());
  const allUserIds = [...new Set(Array.from(calendarDigests.values()).flatMap(m => [...m.keys()]))];

  const [calendars, users, disabledPrefs, baseUrl] = await Promise.all([
    prisma.seasonCalendar.findMany({
      where: { id: { in: allCalendarIds } },
      select: { id: true, brand: { select: { name: true } }, season: { select: { name: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: allUserIds }, isActive: true }, select: { id: true, email: true } }),
    // Scoped to eventKey:'' (category-level rows only) — an event-level mute on one calendar
    // event must not silently drop the entire aggregated digest email for the user.
    prisma.notificationPreference.findMany({ where: { userId: { in: allUserIds }, category: 'CALENDAR', eventKey: CATEGORY_LEVEL_EVENT_KEY, enabled: false }, select: { userId: true } }),
    getConfigOrDefault(prisma, 'app.baseUrl'),
  ]);

  const calendarLabelMap = new Map(calendars.map(c => [c.id, `${c.brand.name} · ${c.season.name}`]));
  const userEmailMap = new Map(users.map(u => [u.id, u.email]));
  const disabledSet = new Set(disabledPrefs.map(p => p.userId));
  const calendarUrl = `${baseUrl}/calendar`;

  const tasks: EmailTask[] = [];

  for (const [calId, userDigestMap] of calendarDigests) {
    const calendarLabel = calendarLabelMap.get(calId) ?? calId;
    const subject = `Recap calendario — ${calendarLabel} — ${dateLabel}`;

    const recipients = onlyUserId
      ? (userDigestMap.has(onlyUserId) ? [[onlyUserId, userDigestMap.get(onlyUserId)!]] as const : [])
      : [...userDigestMap];

    for (const [userId, digest] of recipients) {
      // Manual "send to me" runs bypass the CALENDAR notification-preference opt-out — it's an explicit request.
      if (!onlyUserId && disabledSet.has(userId)) continue;
      const email = userEmailMap.get(userId);
      if (!email) continue;
      const total = digest.created.length + digest.updated.length + digest.deleted.length;
      if (total === 0) continue;

      tasks.push({
        userId,
        calendarId: calId,
        email,
        subject,
        html: generateDigestHtml(dateLabel, digest, calendarUrl, calendarLabel, timeZone),
        text: generateDigestText(dateLabel, digest, calendarLabel, timeZone),
      });
    }
  }

  return { tasks, calendarCount: calendarDigests.size };
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/** What a tick needs from the outside world, injectable so a test drives it without SMTP. */
export interface DigestTickDeps {
  /** Read afresh at every state change, so a long tick never claims with a stale time. */
  clock: () => Date;
  send: (task: EmailTask) => Promise<void>;
  /** `false` when SMTP is not configured: the tick then claims nothing. */
  smtpReady: () => Promise<boolean>;
}

function defaultDeps(prisma: PrismaClient): DigestTickDeps {
  return {
    clock: () => new Date(),
    send: task => sendEmail(prisma, task.email, task.subject, task.html, task.text),
    smtpReady: () => getSmtpConfig(prisma).then(
      () => true,
      err => {
        if (err instanceof TRPCError && err.code === 'PRECONDITION_FAILED') return false;
        throw err;
      },
    ),
  };
}

/** The unique key of one digest email. */
interface DeliveryKey {
  userId: string;
  calendarId: string;
  localDate: Date;
}

function pairKey(userId: string, calendarId: string): string {
  return `${userId}|${calendarId}`;
}

/** Rows re-claimable at `at`: attempts left, send day not over, no live claim and no pending backoff. */
function reclaimable(at: Date): Prisma.CalendarDigestDeliveryWhereInput {
  return { status: { in: ['FAILED', 'SENDING'] }, leaseUntil: { lt: at }, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: at } };
}

/**
 * Rows that can never be sent any more at `at` — disjoint from `reclaimable`. A SENDING row only once
 * its lease has expired (never a live claim); a FAILED one at once, whatever its backoff.
 */
function abandonable(at: Date): Prisma.CalendarDigestDeliveryWhereInput {
  return {
    AND: [
      { OR: [{ status: 'FAILED' }, { status: 'SENDING', leaseUntil: { lt: at } }] },
      { OR: [{ attempts: { gte: MAX_ATTEMPTS } }, { expiresAt: { lte: at } }] },
    ],
  };
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

/**
 * Sends a claimed email and records the outcome, fenced on the claim: a claim lost meanwhile (lease
 * expired and taken over, or abandoned) writes nothing.
 */
async function deliver(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  deps: DigestTickDeps,
  task: EmailTask,
  key: DeliveryKey,
  claimToken: string,
  attempt: number,
): Promise<void> {
  const owned = { ...key, claimToken, status: 'SENDING' as const };
  try {
    await deps.send(task);
  } catch (err) {
    // Logged first: the write below can itself fail.
    log.error({ err, userId: key.userId, calendarId: key.calendarId, attempt }, 'Calendar digest: email send failed');
    const at = deps.clock();
    const { count } = await prisma.calendarDigestDelivery.updateMany({
      where: owned,
      data: { status: 'FAILED', lastError: errorText(err), leaseUntil: new Date(at.getTime() + RETRY_BACKOFF_MS * attempt) },
    });
    if (count !== 1) log.warn({ userId: key.userId, calendarId: key.calendarId }, 'Calendar digest: claim lost before FAILED was recorded');
    return;
  }
  const { count } = await prisma.calendarDigestDelivery.updateMany({ where: owned, data: { status: 'SENT', sentAt: deps.clock(), lastError: null } });
  if (count !== 1) {
    log.warn({ userId: key.userId, calendarId: key.calendarId }, 'Calendar digest: claim lost before SENT was recorded; the email may have gone out');
  }
}

/**
 * Re-claims FAILED emails past their backoff and SENDING ones whose lease expired, each group
 * rebuilt from its stored window in its stored zone. A build that fails changes nothing; a pair a
 * successful build no longer produces (recipient deactivated, opted out, lost access) is abandoned.
 */
async function retryDeliveries(prisma: PrismaClient, log: FastifyInstance['log'], deps: DigestTickDeps): Promise<void> {
  const rows = await prisma.calendarDigestDelivery.findMany({
    where: reclaimable(deps.clock()),
    select: { userId: true, calendarId: true, localDate: true, timeZone: true, windowStart: true, windowEnd: true, attempts: true },
  });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const groupKey = [row.localDate.toISOString(), row.timeZone, row.windowStart.toISOString(), row.windowEnd.toISOString()].join('|');
    const group = groups.get(groupKey);
    if (group) group.push(row);
    else groups.set(groupKey, [row]);
  }

  for (const group of groups.values()) {
    const { timeZone, windowStart, windowEnd } = group[0]!;
    try {
      const pairs = new Set(group.map(row => pairKey(row.userId, row.calendarId)));
      const { tasks } = await buildDigestTasks(prisma, log, {
        range: { start: windowStart, end: windowEnd },
        timeZone,
        include: (userId, calendarId) => pairs.has(pairKey(userId, calendarId)),
      });
      const taskByPair = new Map(tasks.map(task => [pairKey(task.userId, task.calendarId), task]));

      await sendBulkEmail(group, async row => {
        const key = { userId: row.userId, calendarId: row.calendarId, localDate: row.localDate };
        try {
          const task = taskByPair.get(pairKey(row.userId, row.calendarId));
          if (!task) {
            const { count } = await prisma.calendarDigestDelivery.updateMany({
              where: { ...key, status: { in: ['FAILED', 'SENDING'] }, leaseUntil: { lt: deps.clock() } },
              data: { status: 'ABANDONED' },
            });
            if (count === 1) log.warn({ userId: row.userId, calendarId: row.calendarId }, 'Calendar digest: delivery abandoned, the email is no longer produced');
            return;
          }
          const claimToken = randomUUID();
          const at = deps.clock();
          // `attempts` pinned to the value read: the backoff and the last-attempt rule depend on it.
          const { count } = await prisma.calendarDigestDelivery.updateMany({
            where: { ...key, AND: [reclaimable(at), { attempts: row.attempts }] },
            data: { status: 'SENDING', attempts: { increment: 1 }, claimToken, leaseUntil: new Date(at.getTime() + LEASE_MS) },
          });
          if (count === 1) await deliver(prisma, log, deps, task, key, claimToken, row.attempts + 1);
        } catch (err) {
          log.error({ err, userId: row.userId, calendarId: row.calendarId }, 'Calendar digest: retry could not be recorded');
          throw err;
        }
      });
    } catch (err) {
      log.error({ err, timeZone, windowStart }, 'Calendar digest: retry build failed; its deliveries are left as they were');
    }
  }
}

/**
 * First sends for one cohort (the active users reading in `timeZone`) once 07:00 has come there:
 * the window is their local "yesterday", pairs already recorded for the local date are skipped
 * before rendering, and each email is claimed only while its send day lasts.
 */
async function sendDueDigests(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  deps: DigestTickDeps,
  now: Date,
  timeZone: string,
  memberIds: Set<string>,
): Promise<void> {
  const localDate = calendarDateIn(now, timeZone);
  if (now < instantAt(localDate, DIGEST_TIME, timeZone)) return;
  const windowStart = startOfDayIn(addCalendarDays(localDate, -1), timeZone);
  const windowEnd = startOfDayIn(localDate, timeZone);
  const expiresAt = startOfDayIn(addCalendarDays(localDate, 1), timeZone);
  const localDateValue = utcMidnightOf(localDate);

  const recorded = await prisma.calendarDigestDelivery.findMany({
    where: { localDate: localDateValue, userId: { in: [...memberIds] } },
    select: { userId: true, calendarId: true },
  });
  const recordedPairs = new Set(recorded.map(row => pairKey(row.userId, row.calendarId)));
  const { tasks } = await buildDigestTasks(prisma, log, {
    range: { start: windowStart, end: windowEnd },
    timeZone,
    include: (userId, calendarId) => memberIds.has(userId) && !recordedPairs.has(pairKey(userId, calendarId)),
  });

  await sendBulkEmail(tasks, async task => {
    try {
      const at = deps.clock();
      if (at >= expiresAt) {
        log.warn({ userId: task.userId, calendarId: task.calendarId, localDate }, 'Calendar digest: send day over before the email was claimed; not sent');
        return;
      }
      const key = { userId: task.userId, calendarId: task.calendarId, localDate: localDateValue };
      const claimToken = randomUUID();
      // One row per call: only then does the inserted count say whether this row is ours.
      const { count } = await prisma.calendarDigestDelivery.createMany({
        data: [{ ...key, timeZone, windowStart, windowEnd, expiresAt, status: 'SENDING', attempts: 1, claimToken, leaseUntil: new Date(at.getTime() + LEASE_MS) }],
        skipDuplicates: true,
      });
      if (count === 1) await deliver(prisma, log, deps, task, key, claimToken, 1);
    } catch (err) {
      log.error({ err, userId: task.userId, calendarId: task.calendarId }, 'Calendar digest: first send could not be recorded');
      throw err;
    }
  });
}

/**
 * One scheduler tick: abandon what can no longer be sent (logged), stop if SMTP is not configured,
 * retry what failed, then send every cohort whose 07:00 has come. Each retry group and each cohort
 * isolates its own errors.
 */
export async function runDigestTick(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  deps: DigestTickDeps = defaultDeps(prisma),
): Promise<void> {
  // Decides the local date, "due" and the window only; every state change reads the clock again.
  const now = deps.clock();

  const { count: abandoned } = await prisma.calendarDigestDelivery.updateMany({ where: abandonable(deps.clock()), data: { status: 'ABANDONED' } });
  if (abandoned > 0) log.warn({ abandoned }, 'Calendar digest: deliveries abandoned (attempts spent or send day over)');

  if (!(await deps.smtpReady())) {
    log.warn('Calendar digest: SMTP is not configured; nothing claimed');
    return;
  }

  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, timezone: true } });
  const cohorts = await groupByTimeZone(prisma, users, log);

  try {
    await retryDeliveries(prisma, log, deps);
  } catch (err) {
    log.error({ err }, 'Calendar digest: retries failed; first sends go ahead');
  }

  for (const [timeZone, members] of cohorts) {
    try {
      await sendDueDigests(prisma, log, deps, now, timeZone, new Set(members.map(member => member.id)));
    } catch (err) {
      log.error({ err, timeZone }, 'Calendar digest: cohort failed; the others go ahead');
    }
  }
}

// ─── Manual trigger ──────────────────────────────────────────────────────────

/**
 * Sends the requesting user their own digest slice for `days` (inclusive), read in their zone,
 * bypassing their CALENDAR preference opt-out — the manual "send to me" run. Records no delivery:
 * it is an explicit re-send.
 */
export async function runDigestNow(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  days: { from: CalendarDate; to: CalendarDate },
  userId: string,
  send: DigestTickDeps['send'] = defaultDeps(prisma).send,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, timezone: true } });
  const timeZone = await resolveUserTimeZone(prisma, user, log);
  const range = { start: startOfDayIn(days.from, timeZone), end: startOfDayIn(addCalendarDays(days.to, 1), timeZone) };

  const { tasks, calendarCount } = await buildDigestTasks(prisma, log, { range, timeZone, onlyUserId: userId });
  if (tasks.length === 0) return;

  const { sent, failed } = await sendBulkEmail(tasks, task =>
    send(task).catch(err => {
      log.error({ err }, 'Calendar digest: email send failed');
      throw err;
    })
  );
  log.info({ sent, failed, calendars: calendarCount }, 'Calendar digest: manual run completed');
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers the calendar digest scheduler as a Fastify plugin: a tick every 15 minutes sends each
 * recipient their digest from 07:00 in their zone, one email per calendar (brand+season pair),
 * respecting per-user CALENDAR notification preferences.
 */
export function registerCalendarDigestScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  // A tick can outlive the scheduler lock's TTL, and `release` deletes the lock by instance id, so
  // an overlapping tick in this process would drop its successor's lock. Claims stay safe either way.
  let running = false;

  const lockedTick = withSchedulerLock(prisma, 'calendar-digest', () => runDigestTick(prisma, fastify.log));
  const guardedTick = guardMaintenance(prisma, async () => {
    await lockedTick();
  });
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await guardedTick();
    } catch (err) {
      fastify.log.error({ err }, 'Calendar digest scheduler: unhandled error');
    } finally {
      running = false;
    }
  };

  fastify.addHook('onReady', async () => {
    fastify.log.info("Calendar digest scheduler: started (15-min tick, 07:00 in each recipient's zone)");
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Calendar digest scheduler: stopped');
  });
}
