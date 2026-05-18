import type { PrismaClient, NotificationCategory, Prisma } from '@prisma/client';

import { sseStore } from './sseStore';

interface CreateNotificationParams {
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string;
  data?: Record<string, unknown>;
}

export async function createNotification(
  prisma: PrismaClient,
  params: CreateNotificationParams
): Promise<void> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_category: { userId: params.userId, category: params.category } },
    select: { enabled: true },
  });

  if (pref?.enabled === false) return;

  await prisma.notification.create({
    data: {
      userId: params.userId,
      category: params.category,
      title: params.title,
      message: params.message,
      link: params.link ?? null,
      data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  sseStore.pushToUser(params.userId, { type: 'notification', payload: {} });
}

export async function getVisibleUserIdsForMilestone(
  milestoneId: string,
  prisma: PrismaClient
): Promise<string[]> {
  const [fnVisibilities, userVisibilities] = await Promise.all([
    prisma.milestoneVisibility.findMany({ where: { milestoneId }, select: { functionId: true } }),
    prisma.milestoneUserVisibility.findMany({ where: { milestoneId }, select: { userId: true } }),
  ]);

  const functionIds = fnVisibilities.map(v => v.functionId);
  const teamMembers = functionIds.length > 0
    ? await prisma.companyTeamMembership.findMany({
        where: { team: { functionId: { in: functionIds }, isActive: true } },
        select: { userId: true },
      })
    : [];

  const userIds = new Set<string>();
  for (const m of teamMembers) userIds.add(m.userId);
  for (const u of userVisibilities) userIds.add(u.userId);
  return Array.from(userIds);
}

export async function notifyAdmins(
  prisma: PrismaClient,
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });
  if (admins.length === 0) return;

  const adminIds = admins.map(a => a.id);

  // Batch preference check: find only explicitly-disabled prefs
  const disabledPrefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: adminIds }, category: params.category, enabled: false },
    select: { userId: true },
  });
  const disabledSet = new Set(disabledPrefs.map(p => p.userId));
  const toNotify = adminIds.filter(id => !disabledSet.has(id));
  if (toNotify.length === 0) return;

  await prisma.notification.createMany({
    data: toNotify.map(userId => ({
      userId,
      category: params.category,
      title: params.title,
      message: params.message,
      link: params.link ?? null,
      data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });

  for (const userId of toNotify) {
    sseStore.pushToUser(userId, { type: 'notification', payload: {} });
  }
}
