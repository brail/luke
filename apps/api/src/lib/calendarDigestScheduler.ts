/**
 * Daily calendar digest email scheduler.
 *
 * Runs at 07:00 every day. Queries AuditLog for CalendarEvent changes that
 * occurred yesterday, collapses multiple touches to the same event into a
 * single net-change entry (created+deleted in the same period cancels out;
 * repeated edits show one diff from the period's first old value to the
 * final live value), groups the result by calendar and recipient, and sends
 * one branded email digest per calendar per user.
 *
 * Recipients for created/updated events: getVisibleUserIdsForMilestones() + admins.
 * Recipients for deleted events: snapshot stored in AuditLog.metadata.visibleUserIds + admins.
 *
 * If SMTP is not configured the job logs a warning and skips — no crash.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { fullName } from '@luke/core';

import { isRedactedValue } from './auditLog';
import { getConfig } from './configManager';
import { sendEmail } from './mailer';
import { getVisibleUserIdsForMilestones } from './notifications';

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const DIGEST_HOUR = 7;

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

const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Pianificato', IN_PROGRESS: 'In corso', COMPLETED: 'Completata', CANCELLED: 'Annullata',
};

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function formatEventDate(startAt: Date, endAt: Date | null, allDay: boolean): string {
  const dateFmt = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFmt = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const sameDay = !endAt || startAt.toDateString() === endAt.toDateString();
  if (!sameDay) return `${formatShortDate(startAt.toISOString())}–${dateFmt(endAt as Date)}`;
  if (allDay) return dateFmt(startAt);
  return `${dateFmt(startAt)}, ${timeFmt(startAt)}`;
}

/** Builds an event date label from raw (possibly redacted/missing) audit metadata values. */
function dateLabelFromMeta(startAt: unknown, endAt: unknown, allDay: unknown): string | undefined {
  if (typeof startAt !== 'string' || isRedactedValue(startAt)) return undefined;
  const end = typeof endAt === 'string' && !isRedactedValue(endAt) ? new Date(endAt) : null;
  return formatEventDate(new Date(startAt), end, allDay === true);
}

interface UserDigest {
  created: DigestEntry[];
  updated: DigestEntry[];
  deleted: DigestEntry[];
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function entryRow(e: DigestEntry): string {
  const extraLines = [e.dateLabel, e.dateChangeLabel, e.statusChangeLabel, e.otherFieldsLabel]
    .filter((l): l is string => !!l)
    .map(l => `<div style="margin-top:2px;font-size:12px;color:#94a3b8">${l}</div>`)
    .join('');
  return `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b">${e.title}${extraLines}</td><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:right;white-space:nowrap">${e.actorName} · ${e.time}</td></tr>`;
}

function section(heading: string, color: string, entries: DigestEntry[]): string {
  if (entries.length === 0) return '';
  return `
    <p style="margin:24px 0 8px;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${color}">${heading} (${entries.length})</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9">
      ${entries.map(entryRow).join('')}
    </table>`;
}

function generateDigestHtml(dateLabel: string, digest: UserDigest, calendarUrl: string, calendarLabel: string): string {
  const year = new Date().getFullYear();
  const body = [
    section('Nuovi eventi', '#16a34a', digest.created),
    section('Modificati', '#2563eb', digest.updated),
    section('Eliminati', '#dc2626', digest.deleted),
  ].join('');

  const total = digest.created.length + digest.updated.length + digest.deleted.length;

  return `<!doctype html><html lang="it"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Recap calendario</title></head><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f9fafb"><table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;padding:40px 20px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)"><tr><td style="padding:32px 40px 24px;border-bottom:1px solid #e5e7eb"><h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1e293b">Recap calendario</h1><p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#475569">${calendarLabel}</p><p style="margin:0;font-size:14px;color:#64748b">${dateLabel} · ${total} modific${total === 1 ? 'a' : 'he'}</p></td></tr><tr><td style="padding:24px 40px 32px">${body}<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px"><tr><td align="center"><a href="${calendarUrl}" style="display:inline-block;padding:12px 28px;background-color:#1e293b;color:#f8fafc;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600">Vai al calendario</a></td></tr></table><p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Per non ricevere questi aggiornamenti, disabilitali nelle <strong>preferenze di notifica → Calendario</strong>.</p></td></tr><tr><td style="padding:20px 40px;background-color:#f8fafc;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px"><p style="margin:0;font-size:12px;text-align:center;color:#94a3b8">© ${year} Luke. Tutti i diritti riservati.</p></td></tr></table></td></tr></table></body></html>`;
}

function generateDigestText(dateLabel: string, digest: UserDigest, calendarLabel: string): string {
  const lines: string[] = [`Recap calendario — ${calendarLabel} — ${dateLabel}`, ''];

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

async function runDigestCore(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  range?: DigestDateRange,
  onlyUserId?: string,
): Promise<void> {
  log.info('Calendar digest scheduler: avvio digest giornaliero');

  let rangeStart: Date;
  let rangeEnd: Date;
  if (range) {
    rangeStart = range.start;
    rangeEnd = range.end;
  } else {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    rangeStart = new Date(yesterday);
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd = new Date(now);
    rangeEnd.setHours(0, 0, 0, 0);
  }

  const fmtDay = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const sameDay = rangeEnd.getTime() - rangeStart.getTime() <= 24 * 60 * 60 * 1000;
  const dateLabel = sameDay ? fmtDay(rangeStart) : `dal ${fmtDay(rangeStart)} al ${fmtDay(new Date(rangeEnd.getTime() - 1))}`;

  const logs = await prisma.auditLog.findMany({
    where: {
      targetType: { in: ['CalendarEvent', 'CalendarMilestone'] },
      action: { in: ['CALENDAR_EVENT_CREATE', 'CALENDAR_EVENT_UPDATE', 'CALENDAR_EVENT_STATUS_UPDATE', 'CALENDAR_MILESTONE_DELETE', 'CALENDAR_EVENT_DELETE'] },
      result: 'SUCCESS',
      createdAt: { gte: rangeStart, lt: rangeEnd },
    },
    include: { actor: { select: { id: true, firstName: true, lastName: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (logs.length === 0) {
    log.info('Calendar digest: nessuna modifica ieri, skip');
    return;
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
    const time = entry.createdAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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

  // An event is "net deleted" if its most recent touch in the period was a delete.
  const liveTargetIds = [...byEvent.entries()]
    .filter(([, chgs]) => !DELETE_ACTIONS.has(chgs[chgs.length - 1].action))
    .map(([id]) => id);

  // Parallel pre-fetches
  const [adminResult, visibilityMap, liveEvents] = await Promise.all([
    prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
    getVisibleUserIdsForMilestones(liveTargetIds, prisma).catch(() => new Map<string, string[]>()),
    liveTargetIds.length > 0
      ? prisma.calendarEvent.findMany({ where: { id: { in: liveTargetIds } }, select: { id: true, title: true, calendarId: true, startAt: true, endAt: true, allDay: true, status: true } })
      : Promise.resolve([]),
  ]);
  const adminIds = adminResult.map(a => a.id);
  const liveEventMap = new Map(liveEvents.map(e => [e.id, e]));

  // Build per-calendar per-user digest map: calendarId → userId → UserDigest
  const calendarDigests = new Map<string, Map<string, UserDigest>>();

  const addEntry = (calId: string, uid: string, bucket: keyof UserDigest, entry: DigestEntry) => {
    if (!calendarDigests.has(calId)) calendarDigests.set(calId, new Map());
    const calMap = calendarDigests.get(calId)!;
    if (!calMap.has(uid)) calMap.set(uid, { created: [], updated: [], deleted: [] });
    calMap.get(uid)![bucket].push(entry);
  };

  for (const [eventId, chgs] of byEvent) {
    const last = chgs[chgs.length - 1];
    const isNetDeleted = DELETE_ACTIONS.has(last.action);
    const hasCreate = chgs.some(c => c.action === 'CALENDAR_EVENT_CREATE');
    const actorIds = chgs.map(c => c.actorId).filter((id): id is string => !!id);

    // Created then deleted within the same period: net zero, drop entirely.
    if (isNetDeleted && hasCreate) continue;

    if (isNetDeleted) {
      const meta = last.meta;
      const title = (!isRedactedValue(meta.title) && typeof meta.title === 'string' ? meta.title : null) ?? '(evento)';
      const calendarId = !isRedactedValue(meta.calendarId) && typeof meta.calendarId === 'string' ? meta.calendarId : null;
      if (!calendarId) continue;
      const dateLabel = dateLabelFromMeta(meta.startAt, meta.endAt, meta.allDay);
      const extraIds = Array.isArray(meta.visibleUserIds) ? (meta.visibleUserIds as string[]) : [];
      const recipientIds = new Set([...adminIds, ...extraIds, ...actorIds]);
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
    const dateLabel = liveEvent ? formatEventDate(liveEvent.startAt, liveEvent.endAt, liveEvent.allDay) : undefined;
    const extraIds = visibilityMap.get(eventId) ?? [];
    const recipientIds = new Set([...adminIds, ...extraIds, ...actorIds]);

    if (hasCreate) {
      // Brand-new event this period — final state is all that matters, no diff needed.
      for (const uid of recipientIds) {
        addEntry(calendarId, uid, 'created', { title, actorName: last.actorName, time: last.time, dateLabel });
      }
      continue;
    }

    // Pure update(s)/status change(s) — collapse into a single net diff over the whole period.
    const updateChanges = chgs.filter(c => c.action === 'CALENDAR_EVENT_UPDATE');
    const statusChanges = chgs.filter(c => c.action === 'CALENDAR_EVENT_STATUS_UPDATE');

    let dateChangeLabel: string | undefined;
    const firstDateChange = updateChanges.find(c => typeof c.meta.oldStartAt === 'string');
    if (firstDateChange && liveEvent) {
      const oldStart = new Date(firstDateChange.meta.oldStartAt as string);
      const newStart = liveEvent.startAt;
      if (oldStart.getTime() !== newStart.getTime()) {
        const direction = newStart.getTime() > oldStart.getTime() ? 'Posticipato' : 'Anticipato';
        dateChangeLabel = `${direction}: ${formatShortDate(oldStart.toISOString())} → ${formatShortDate(newStart.toISOString())}`;
      } else {
        const oldEndRaw = firstDateChange.meta.oldEndAt;
        const oldEnd = typeof oldEndRaw === 'string' ? formatShortDate(oldEndRaw) : '—';
        const newEnd = liveEvent.endAt ? formatShortDate(liveEvent.endAt.toISOString()) : '—';
        if (oldEnd !== newEnd) dateChangeLabel = `Durata modificata: fine ${oldEnd} → ${newEnd}`;
      }
    }

    let statusChangeLabel: string | undefined;
    const firstStatusChange = statusChanges.find(c => typeof c.meta.oldStatus === 'string');
    if (firstStatusChange && liveEvent) {
      const oldStatus = firstStatusChange.meta.oldStatus as string;
      const newStatus = liveEvent.status;
      if (oldStatus !== newStatus) {
        statusChangeLabel = `Stato: ${STATUS_LABELS[oldStatus] ?? oldStatus} → ${STATUS_LABELS[newStatus] ?? newStatus}`;
      }
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

  if (calendarDigests.size === 0) return;

  // Fetch calendar labels + user emails + preferences + baseUrl in parallel
  const allCalendarIds = Array.from(calendarDigests.keys());
  const allUserIds = [...new Set(Array.from(calendarDigests.values()).flatMap(m => [...m.keys()]))];

  const [calendars, users, disabledPrefs, baseUrlRaw] = await Promise.all([
    prisma.seasonCalendar.findMany({
      where: { id: { in: allCalendarIds } },
      select: { id: true, brand: { select: { name: true } }, season: { select: { name: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: allUserIds }, isActive: true }, select: { id: true, email: true } }),
    prisma.notificationPreference.findMany({ where: { userId: { in: allUserIds }, category: 'CALENDAR', enabled: false }, select: { userId: true } }),
    getConfig(prisma, 'app.baseUrl', false),
  ]);

  const calendarLabelMap = new Map(calendars.map(c => [c.id, `${c.brand.name} · ${c.season.name}`]));
  const userEmailMap = new Map(users.map(u => [u.id, u.email]));
  const disabledSet = new Set(disabledPrefs.map(p => p.userId));
  const calendarUrl = `${baseUrlRaw || 'http://localhost:3000'}/calendar`;

  // Send one email per calendar per user
  const sendTasks: Promise<void>[] = [];

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

      const html = generateDigestHtml(dateLabel, digest, calendarUrl, calendarLabel);
      const text = generateDigestText(dateLabel, digest, calendarLabel);
      sendTasks.push(sendEmail(prisma, email, subject, html, text));
    }
  }

  const results = await Promise.allSettled(sendTasks);
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  for (const result of results) {
    if (result.status === 'rejected') {
      log.error({ err: result.reason }, 'Calendar digest: invio email fallito');
    }
  }

  log.info({ sent, failed, calendars: calendarDigests.size }, 'Calendar digest: completato');
}

function runDigest(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  state: { lastDigestDate: string | null },
): Promise<void> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (state.lastDigestDate === today) return Promise.resolve();
  if (now.getHours() !== DIGEST_HOUR) return Promise.resolve();
  state.lastDigestDate = today;
  return runDigestCore(prisma, log);
}

// ─── Manual trigger ──────────────────────────────────────────────────────────

/**
 * Runs the digest immediately, bypassing the hour guard.
 * Defaults to the previous day if no range is given.
 * When `onlyUserId` is given, sends only to that user's own digest slice
 * (bypassing their CALENDAR preference opt-out) — used for manual "send to me" test runs.
 * Intended for admin-triggered manual runs and testing.
 */
export async function runDigestNow(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
  range?: DigestDateRange,
  onlyUserId?: string,
): Promise<void> {
  await runDigestCore(prisma, log, range, onlyUserId);
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Registers the daily calendar digest email scheduler as a Fastify plugin.
 * Fires daily at 07:00, covering changes from the previous day.
 * Sends one email per calendar (brand+season pair) per user.
 * Respects per-user CALENDAR notification preferences.
 * Skips gracefully if SMTP is not configured.
 */
export function registerCalendarDigestScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const state = { lastDigestDate: null as string | null };

  const run = () =>
    runDigest(prisma, fastify.log, state).catch(err =>
      fastify.log.error({ err }, 'Calendar digest scheduler: errore non gestito')
    );

  fastify.addHook('onReady', async () => {
    fastify.log.info('Calendar digest scheduler: avviato (tick ogni ora, esecuzione alle 07:00)');
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Calendar digest scheduler: fermato');
  });
}
