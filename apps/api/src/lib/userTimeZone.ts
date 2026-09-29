/**
 * The zone a person reads dates and times in: their `User.timezone`, validated as an IANA name.
 * Both write paths refuse anything else; the fallback here is for rows stored before they did. A
 * bad zone never throws, so one such row cannot stop a batch over many users.
 */

import { canonicalTimeZone, isValidTimeZone } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getConfigOrDefault } from './configManager';

import type { FastifyBaseLogger } from 'fastify';

interface ZonedUser {
  id: string;
  timezone: string;
}

/** `user.timezone` when valid; otherwise a warning naming the user, and `businessZone()`. */
function resolveOr(user: ZonedUser, log: FastifyBaseLogger, businessZone: () => Promise<string>): Promise<string> {
  // In the case Intl spells it, so a row written before the schema normalised it joins its zone.
  if (isValidTimeZone(user.timezone)) return Promise.resolve(canonicalTimeZone(user.timezone));
  log.warn({ userId: user.id, timezone: user.timezone }, 'User.timezone is not an IANA zone; using the business zone');
  return businessZone();
}

/**
 * `user.timezone` when it is an IANA zone; otherwise the business zone (`app.defaultTimezone`),
 * with a warning naming the user so the row can be corrected.
 */
export function resolveUserTimeZone(prisma: PrismaClient, user: ZonedUser, log: FastifyBaseLogger): Promise<string> {
  return resolveOr(user, log, () => getConfigOrDefault(prisma, 'app.defaultTimezone'));
}

/** The zone `userId` reads in (`resolveUserTimeZone`), from their row; the business zone if there is none. */
export async function getUserTimeZone(prisma: PrismaClient, userId: string, log: FastifyBaseLogger): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  return resolveUserTimeZone(prisma, { id: userId, timezone: user?.timezone ?? '' }, log);
}

/**
 * `users` grouped by the zone each one reads in (`resolveUserTimeZone`); the business zone is read
 * at most once, however many rows need it.
 */
export async function groupByTimeZone<T extends ZonedUser>(
  prisma: PrismaClient,
  users: T[],
  log: FastifyBaseLogger,
): Promise<Map<string, T[]>> {
  let businessZone: Promise<string> | undefined;
  const readBusinessZone = () => (businessZone ??= getConfigOrDefault(prisma, 'app.defaultTimezone'));

  const groups = new Map<string, T[]>();
  for (const user of users) {
    const zone = await resolveOr(user, log, readBusinessZone);
    const group = groups.get(zone);
    if (group) group.push(user);
    else groups.set(zone, [user]);
  }
  return groups;
}
