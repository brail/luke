/**
 * The initial access snapshot (#222): the access the system grants when the access history starts,
 * so a reader of "who could reach what at date D" folds the change rows over a known state.
 *
 * Written once, at start-up, while no `ACCESS_SNAPSHOT` row exists: on the first start after the
 * upgrade, on a fresh install, and again after retention or a restore has removed it — the history
 * before it is gone with it, so a new baseline is the right one. Every row has the shape of the
 * row that creates its target (a user's and an event's `new*` keys), and no actor. The section
 * defaults are the exception: resolved over the static table, as the application applied them —
 * a stored entry the reader ignores is not access anyone had.
 */

import { getRbacConfig } from '@luke/core/server';
import { Prisma, type PrismaClient } from '@luke/db';

import { logAuditMany, type AuditContext, type AuditParams } from './auditLog';

const SNAPSHOT_LOCK_KEY = 'luke:access-snapshot';

type SnapshotLogger = NonNullable<AuditContext['logger']>;

/** One snapshot row: the change rows' target and metadata, action `ACCESS_SNAPSHOT`. */
function row(targetType: string, targetId: string, metadata: AuditParams['metadata']): AuditParams {
  return { action: 'ACCESS_SNAPSHOT', targetType, targetId, result: 'SUCCESS', metadata };
}

/**
 * Writes the snapshot unless one exists, in one transaction: two instances starting together write
 * one. Nothing is written when it fails.
 *
 * @returns The number of rows written: 0 when a snapshot already exists.
 */
export async function recordInitialAccessSnapshot(prisma: PrismaClient, logger: SnapshotLogger): Promise<number> {
  // READ COMMITTED explicitly: under REPEATABLE READ the existence check would read the snapshot
  // taken before the lock wait and miss the rows another instance has just committed.
  return prisma.$transaction(async tx => {
    // Transaction-scoped advisory lock (CLAUDE.md "Raw SQL" exception): a second instance waits,
    // then finds the first one's rows.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SNAPSHOT_LOCK_KEY}))`;
    if (await tx.auditLog.findFirst({ where: { action: 'ACCESS_SNAPSHOT' }, select: { id: true } })) return 0;

    // One read after the other, each at its own commit state: at start-up this instance serves
    // nothing yet, so only another instance's writes could land between two of them.
    const users = await tx.user.findMany({ select: { id: true, role: true, isActive: true, pendingApproval: true } });
    const teams = await tx.companyTeam.findMany({
      select: { id: true, name: true, functionId: true, isActive: true, brandScopes: { select: { brandId: true } } },
    });
    const memberships = await tx.companyTeamMembership.findMany({ select: { teamId: true, userId: true, role: true } });
    const shares = await tx.calendarEventUserVisibility.findMany({ select: { eventId: true, userId: true } });
    const eventFunctions = await tx.calendarEventVisibility.findMany({ select: { eventId: true, functionId: true } });
    const overrides = await tx.userSectionAccess.findMany({ select: { userId: true, section: true, enabled: true } });
    const rbac = await getRbacConfig(tx, { bypassCache: true });

    const functionsByEvent = new Map<string, string[]>();
    for (const { eventId, functionId } of eventFunctions) {
      const ids = functionsByEvent.get(eventId);
      if (ids) ids.push(functionId);
      else functionsByEvent.set(eventId, [functionId]);
    }

    const rows = [
      ...users.map(u => row('User', u.id, { newRole: u.role, newIsActive: u.isActive, newPendingApproval: u.pendingApproval })),
      ...teams.map(t => row('CompanyTeam', t.id, {
        name: t.name, functionId: t.functionId, brandIds: t.brandScopes.map(s => s.brandId).sort(), isActive: t.isActive,
      })),
      ...memberships.map(m => row('CompanyTeamMembership', `${m.teamId}:${m.userId}`, { teamId: m.teamId, userId: m.userId, role: m.role })),
      ...shares.map(s => row('CalendarEventUserVisibility', `${s.eventId}:${s.userId}`, { eventId: s.eventId, userId: s.userId })),
      ...[...functionsByEvent].map(([eventId, functionIds]) => row('CalendarEvent', eventId, { oldVisibilityFunctionIds: [], newVisibilityFunctionIds: functionIds.sort() })),
      ...overrides.map(o => row('UserSectionAccess', `${o.userId}:${o.section}`, { targetUserId: o.userId, section: o.section, enabled: o.enabled })),
      // As the application reads them: the defaults resolved over the static table, the kill switch
      // without the entries it ignores.
      row('Config', 'rbac.sectionAccessDefaults', { sectionAccessDefaults: rbac.sectionAccessDefaults }),
      row('Config', 'app.sections.disabled', { sectionsDisabled: rbac.disabledSections }),
    ];
    await logAuditMany({ prisma, logger }, rows, { tx });
    return rows.length;
    // Once per database, before the API listens: room for every row of a large one.
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000 });
}

/**
 * `recordInitialAccessSnapshot` for start-up: a failure is logged and the API starts all the same;
 * the next start tries again.
 */
export async function runInitialAccessSnapshot(prisma: PrismaClient, logger: SnapshotLogger): Promise<void> {
  try {
    const written = await recordInitialAccessSnapshot(prisma, logger);
    if (written > 0) logger.info({ rows: written }, 'Initial access snapshot written');
  } catch (err) {
    logger.error({ err }, 'Initial access snapshot failed');
  }
}
