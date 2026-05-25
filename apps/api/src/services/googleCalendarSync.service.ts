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
  visibilities: { companyFunctionId: string }[];
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
    visibilityFunctionIds: m.visibilities.map(v => v.companyFunctionId),
  };
}

export async function getMilestoneForSync(
  milestoneId: string,
  prisma: PrismaClient
): Promise<MilestoneForSync> {
  const m = await prisma.calendarEvent.findUniqueOrThrow({
    where: { id: milestoneId },
    include: { visibilities: { select: { functionId: true } } },
  });
  return mapMilestone({
    ...m,
    visibilities: m.visibilities.map(v => ({ companyFunctionId: v.functionId })),
  });
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
      await syncCalendarReaders(googleCalendarId, allowedUserEmails);

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

export async function syncOneMilestone(
  milestoneId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return;

  const m = await prisma.calendarEvent.findUniqueOrThrow({
    where: { id: milestoneId },
    include: { visibilities: { select: { functionId: true } } },
  });

  const ctx = await buildSyncContext(m.calendarId, prisma);
  await syncMilestone(
    mapMilestone({ ...m, visibilities: m.visibilities.map(v => ({ companyFunctionId: v.functionId })) }),
    ctx
  );
  logger.info({ milestoneId }, 'Google Calendar sync completed');
}

export async function cleanupMilestoneEvents(
  milestoneId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<void> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return;

  const mappings = await prisma.googleEventMapping.findMany({ where: { eventId: milestoneId } });

  await Promise.allSettled(
    mappings.map(m => deleteEvent(m.googleCalendarId, m.googleEventId))
  );

  await prisma.googleEventMapping.deleteMany({ where: { eventId: milestoneId } });
  logger.info({ milestoneId, count: mappings.length }, 'Google Calendar events cleaned up');
}

export async function reconcileCalendar(
  calendarId: string,
  prisma: PrismaClient,
  logger: SyncLogger
): Promise<{ synced: number; errors: number }> {
  const creds = await getConfiguredGoogleClient(prisma);
  if (!creds) return { synced: 0, errors: 0 };

  const milestones = await prisma.calendarEvent.findMany({
    where: { calendarId },
    include: { visibilities: { select: { functionId: true } } },
  });

  if (milestones.length === 0) return { synced: 0, errors: 0 };

  const ctx = await buildSyncContext(calendarId, prisma);

  let synced = 0;
  let errors = 0;

  for (const m of milestones) {
    try {
      await syncMilestone(
        mapMilestone({ ...m, visibilities: m.visibilities.map(v => ({ companyFunctionId: v.functionId })) }),
        ctx
      );
      synced++;
    } catch (err) {
      errors++;
      logger.error({ err, milestoneId: m.id }, 'Google Calendar reconcile error for milestone');
    }
  }

  logger.info({ calendarId, synced, errors }, 'Google Calendar reconciliation completed');
  return { synced, errors };
}
