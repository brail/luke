import type { PrismaClient } from '@prisma/client';

interface SyncLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

import {
  createGoogleCalendarClient,
  syncMilestone,
  deleteEvent,
  buildCalendarSummary,
  createCalendar,
  syncCalendarReaders,
  type MilestoneForSync,
  type SyncContext,
} from '@luke/calendar';
import type { PlanningSectionKey } from '@luke/core';

import { getConfig } from '../lib/configManager.js';

// ─── Client factory ───────────────────────────────────────────────────────────

export async function getConfiguredGoogleClient(prisma: PrismaClient): Promise<{ domain: string } | null> {
  const [authMode, domain, enabled] = await Promise.all([
    getConfig(prisma, 'integrations.google.authMode', false),
    getConfig(prisma, 'integrations.google.domain', false),
    getConfig(prisma, 'integrations.google.calendarSync.enabled', false),
  ]);

  if (!domain || enabled !== 'true') return null;

  if (authMode === 'oauth_user') {
    const [clientId, clientSecret, refreshToken] = await Promise.all([
      getConfig(prisma, 'integrations.google.oauth.clientId', false),
      getConfig(prisma, 'integrations.google.oauth.clientSecret', true),
      getConfig(prisma, 'integrations.google.oauth.refreshToken', true),
    ]);
    if (!clientId || !clientSecret || !refreshToken) return null;
    createGoogleCalendarClient({ mode: 'oauth_user', clientId, clientSecret, refreshToken, workspaceDomain: domain });
  } else {
    const [serviceEmail, serviceKey, impersonateEmail] = await Promise.all([
      getConfig(prisma, 'integrations.google.serviceEmail', false),
      getConfig(prisma, 'integrations.google.serviceKey', true),
      getConfig(prisma, 'integrations.google.impersonateEmail', false),
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
  status: string;
  publishExternally: boolean;
  visibilities: { sectionKey: string }[];
};

function mapMilestone(m: MilestoneRow): MilestoneForSync {
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    startAt: m.startAt,
    endAt: m.endAt,
    allDay: m.allDay,
    status: m.status,
    publishExternally: m.publishExternally,
    visibleSectionKeys: m.visibilities.map(v => v.sectionKey as PlanningSectionKey),
  };
}

export async function getMilestoneForSync(
  milestoneId: string,
  prisma: PrismaClient
): Promise<MilestoneForSync> {
  const m = await prisma.calendarMilestone.findUniqueOrThrow({
    where: { id: milestoneId },
    include: { visibilities: { select: { sectionKey: true } } },
  });
  return mapMilestone(m);
}

// ─── SyncContext builder ──────────────────────────────────────────────────────

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

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  const allowedUserEmails = users.map(u => u.email).filter((e): e is string => !!e);

  const brandCode = cal.brand.code;
  const seasonCode = cal.season.code;

  return {
    seasonCalendarId: calendarId,
    brandCode,
    seasonCode,
    allowedUserEmails,

    getOrCreateBinding: async (sectionKey) => {
      const existing = await prisma.googleCalendarBinding.findUnique({
        where: { seasonCalendarId_sectionKey: { seasonCalendarId: calendarId, sectionKey } },
      });
      if (existing?.isProvisioned) return existing;

      const summary = buildCalendarSummary(brandCode, seasonCode, sectionKey);
      const { id: googleCalendarId } = await createCalendar(summary);
      await syncCalendarReaders(googleCalendarId, allowedUserEmails);

      return prisma.googleCalendarBinding.upsert({
        where: { seasonCalendarId_sectionKey: { seasonCalendarId: calendarId, sectionKey } },
        create: { seasonCalendarId: calendarId, sectionKey, googleCalendarId, isProvisioned: true },
        update: { googleCalendarId, isProvisioned: true },
      });
    },

    getMappings: (milestoneId) =>
      prisma.googleEventMapping.findMany({ where: { milestoneId } }),

    upsertMapping: async (mapping) => {
      await prisma.googleEventMapping.upsert({
        where: { milestoneId_sectionKey: { milestoneId: mapping.milestoneId, sectionKey: mapping.sectionKey } },
        create: { ...mapping, lastSyncedAt: new Date() },
        update: { ...mapping, lastSyncedAt: new Date() },
      });
    },

    deleteMapping: async (milestoneId, sectionKey) => {
      await prisma.googleEventMapping.deleteMany({
        where: { milestoneId, sectionKey },
      });
    },
  };
}

// ─── Sync operations ─────────────────────────────────────────────────────────

export async function syncOneMilestone(
  milestoneId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return;

  const m = await prisma.calendarMilestone.findUniqueOrThrow({
    where: { id: milestoneId },
    include: { visibilities: { select: { sectionKey: true } } },
  });

  const ctx = await buildSyncContext(m.calendarId, prisma);
  await syncMilestone(mapMilestone(m), ctx);
  logger.info({ milestoneId }, 'Google Calendar sync completed');
}

export async function cleanupMilestoneEvents(
  milestoneId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return;

  const mappings = await prisma.googleEventMapping.findMany({ where: { milestoneId } });

  await Promise.allSettled(
    mappings.map(m => deleteEvent(m.googleCalendarId, m.googleEventId))
  );

  await prisma.googleEventMapping.deleteMany({ where: { milestoneId } });
  logger.info({ milestoneId, count: mappings.length }, 'Google Calendar events cleaned up');
}

export async function reconcileCalendar(
  calendarId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<{ synced: number; errors: number }> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return { synced: 0, errors: 0 };

  const milestones = await prisma.calendarMilestone.findMany({
    where: { calendarId },
    include: { visibilities: { select: { sectionKey: true } } },
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
