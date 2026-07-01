/**
 * Daily calendar digest email scheduler.
 *
 * Runs at 07:00 every day. Queries AuditLog for CalendarEvent changes that
 * occurred yesterday, groups them by calendar (brand+season) and recipient,
 * and sends one branded email digest per calendar per user.
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
}

interface UserDigest {
  created: DigestEntry[];
  updated: DigestEntry[];
  deleted: DigestEntry[];
}

// ─── HTML generation ─────────────────────────────────────────────────────────

function entryRow(e: DigestEntry): string {
  return `<tr><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b">${e.title}</td><td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:right;white-space:nowrap">${e.actorName} · ${e.time}</td></tr>`;
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

  if (digest.created.length > 0) {
    lines.push(`NUOVI EVENTI (${digest.created.length})`);
    digest.created.forEach(e => lines.push(`• ${e.title}  (${e.actorName}, ${e.time})`));
    lines.push('');
  }
  if (digest.updated.length > 0) {
    lines.push(`MODIFICATI (${digest.updated.length})`);
    digest.updated.forEach(e => lines.push(`• ${e.title}  (${e.actorName}, ${e.time})`));
    lines.push('');
  }
  if (digest.deleted.length > 0) {
    lines.push(`ELIMINATI (${digest.deleted.length})`);
    digest.deleted.forEach(e => lines.push(`• ${e.title}  (${e.actorName}, ${e.time})`));
    lines.push('');
  }

  lines.push('Per disabilitare questi aggiornamenti: preferenze di notifica → Calendario.');
  return lines.join('\n');
}

// ─── Core logic ──────────────────────────────────────────────────────────────

async function runDigestCore(
  prisma: PrismaClient,
  log: FastifyInstance['log'],
): Promise<void> {
  log.info('Calendar digest scheduler: avvio digest giornaliero');

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = new Date(yesterday);
  yesterdayStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const dateLabel = yesterdayStart.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  const logs = await prisma.auditLog.findMany({
    where: {
      targetType: { in: ['CalendarEvent', 'CalendarMilestone'] },
      action: { in: ['CALENDAR_EVENT_CREATE', 'CALENDAR_EVENT_UPDATE', 'CALENDAR_EVENT_STATUS_UPDATE', 'CALENDAR_MILESTONE_DELETE', 'CALENDAR_EVENT_DELETE'] },
      result: 'SUCCESS',
      createdAt: { gte: yesterdayStart, lt: todayStart },
    },
    include: { actor: { select: { id: true, firstName: true, lastName: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (logs.length === 0) {
    log.info('Calendar digest: nessuna modifica ieri, skip');
    return;
  }

  const DELETE_ACTIONS = new Set(['CALENDAR_EVENT_DELETE', 'CALENDAR_MILESTONE_DELETE']);

  // Derive IDs needed for parallel pre-fetches (sync, no await)
  const liveTargetIds = [...new Set(
    logs.filter(e => !DELETE_ACTIONS.has(e.action) && e.targetId).map(e => e.targetId as string),
  )];
  const needLiveInfoIds = [...new Set(
    logs
      .filter(e => {
        const meta = (e.metadata ?? {}) as Record<string, unknown>;
        return (!isRedactedValue(meta.title) === false || !isRedactedValue(meta.calendarId) === false
          || typeof meta.title !== 'string' || typeof meta.calendarId !== 'string')
          && !DELETE_ACTIONS.has(e.action) && e.targetId;
      })
      .map(e => e.targetId as string),
  )];

  // Parallel pre-fetches
  const [adminResult, visibilityMap, liveEvents] = await Promise.all([
    prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
    getVisibleUserIdsForMilestones(liveTargetIds, prisma).catch(() => new Map<string, string[]>()),
    needLiveInfoIds.length > 0
      ? prisma.calendarEvent.findMany({ where: { id: { in: needLiveInfoIds } }, select: { id: true, title: true, calendarId: true } })
      : Promise.resolve([]),
  ]);
  const adminIds = adminResult.map(a => a.id);
  const liveEventMap = new Map(liveEvents.map(e => [e.id, { title: e.title, calendarId: e.calendarId }]));

  // Build per-calendar per-user digest map: calendarId → userId → UserDigest
  const calendarDigests = new Map<string, Map<string, UserDigest>>();

  const addEntry = (calId: string, uid: string, bucket: keyof UserDigest, entry: DigestEntry) => {
    if (!calendarDigests.has(calId)) calendarDigests.set(calId, new Map());
    const calMap = calendarDigests.get(calId)!;
    if (!calMap.has(uid)) calMap.set(uid, { created: [], updated: [], deleted: [] });
    calMap.get(uid)![bucket].push(entry);
  };

  for (const entry of logs) {
    const actor = entry.actor;
    const actorName = actor ? fullName(actor) : 'Sistema';
    const time = entry.createdAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const meta = (entry.metadata ?? {}) as Record<string, unknown>;

    const isDelete = DELETE_ACTIONS.has(entry.action);
    const bucket: keyof UserDigest = entry.action === 'CALENDAR_EVENT_CREATE'
      ? 'created'
      : isDelete ? 'deleted' : 'updated';

    // Bulk delete: expand snapshots into individual entries
    if (entry.action === 'CALENDAR_EVENT_DELETE' && Array.isArray(meta.snapshots)) {
      const snapshots = meta.snapshots as Array<{ id?: string; title?: string; calendarId?: string; visibleUserIds?: string[] }>;
      for (const snap of snapshots) {
        const snapTitle = !isRedactedValue(snap.title) && typeof snap.title === 'string' ? snap.title : '(evento)';
        const snapCalId = typeof snap.calendarId === 'string' && !isRedactedValue(snap.calendarId) ? snap.calendarId : null;
        if (!snapCalId) continue;
        const snapRecipients = new Set([...adminIds, ...(snap.visibleUserIds ?? [])]);
        for (const uid of snapRecipients) {
          if (uid !== entry.actorId) addEntry(snapCalId, uid, 'deleted', { title: snapTitle, actorName, time });
        }
      }
      continue;
    }

    // Resolve calendarId: prefer metadata unless redacted, fallback to live DB lookup
    const calendarId = (!isRedactedValue(meta.calendarId) && typeof meta.calendarId === 'string' ? meta.calendarId : null)
      ?? (entry.targetId ? (liveEventMap.get(entry.targetId)?.calendarId ?? null) : null);
    if (!calendarId) continue;

    // Recipient IDs: admins + visible users
    const extraIds = isDelete
      ? (Array.isArray(meta.visibleUserIds) ? (meta.visibleUserIds as string[]) : [])
      : (entry.targetId ? (visibilityMap.get(entry.targetId) ?? []) : []);
    const recipientIds = new Set([...adminIds, ...extraIds]);

    // Title: prefer audit metadata unless redacted, fallback to live event, then targetId
    const title = (!isRedactedValue(meta.title) && typeof meta.title === 'string' ? meta.title : null)
      ?? (entry.targetId ? (liveEventMap.get(entry.targetId)?.title ?? entry.targetId ?? '(evento)') : '(evento)');

    for (const uid of recipientIds) {
      if (uid !== entry.actorId) addEntry(calendarId, uid, bucket, { title, actorName, time });
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

    for (const [userId, digest] of userDigestMap) {
      if (disabledSet.has(userId)) continue;
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
 * Runs the digest immediately for the previous day, bypassing the hour guard.
 * Intended for admin-triggered manual runs and testing.
 */
export async function runDigestNow(prisma: PrismaClient, log: FastifyInstance['log']): Promise<void> {
  await runDigestCore(prisma, log);
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
