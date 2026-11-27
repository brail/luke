/**
 * Maintenance-mode state machine: INACTIVE -> SCHEDULED -> ACTIVE -> INACTIVE.
 * State lives in a single AppConfig row (`maintenance.mode.state`, JSON blob — see
 * packages/core/src/schemas/config.ts) rather than one row per field: nothing outside this
 * module ever reads an individual sub-field, so a single row keeps writes atomic for free
 * instead of needing a multi-row `$transaction`.
 *
 * Cached in-memory with a short TTL (same pattern as `tokenVersionCache` in trpc.ts) since
 * `isMaintenanceActive()` is read on every protected tRPC call. The TTL is much shorter than
 * the token-version cache's because this gates a rarely-changing-but-must-propagate-fast state
 * transition (an admin ending maintenance should unblock users within seconds, not a full TTL).
 */

import { hasPermission, MaintenanceModeStateSchema, Roles, type MaintenanceModeState, type Role } from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

import {
  UnreadableStoredConfigError,
  acquireAppConfigWriteLock,
  getConfig,
  saveConfig,
  writeConfigsTx,
} from './configManager';
import { ServiceUnavailableError } from './error';
import { revokingTransaction } from './sessionRevocation';
import { sseStore } from './sseStore';


export type { MaintenanceModeState, MaintenanceModeStatus } from '@luke/core';

const CONFIG_KEY = 'maintenance.mode.state';

/** The inactive state with nothing scheduled: what a missing row reads as, and what ending or cancelling writes. */
export const DEFAULT_STATE: MaintenanceModeState = {
  status: 'INACTIVE',
  scheduledAt: null,
  activatedAt: null,
  message: null,
  forceLogout: false,
  warningLeadMinutes: [],
  warningsSent: [],
  activatedByUserId: null,
  notifyByEmail: false,
};

const CACHE_TTL_MS = 5_000;
let cached: { state: MaintenanceModeState; timestamp: number } | null = null;

/** The stored state, never cached. Missing or corrupt state fails safe to `DEFAULT_STATE` (INACTIVE). */
async function readStoredState(prisma: Prisma.TransactionClient): Promise<MaintenanceModeState> {
  // A row that does not decrypt is corrupt state too; a database error still propagates.
  const raw = await getConfig(prisma, CONFIG_KEY).catch((error: unknown) => {
    if (error instanceof UnreadableStoredConfigError) return null;
    throw error;
  });
  if (!raw) return DEFAULT_STATE;
  try {
    return MaintenanceModeStateSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

/** Reads the current maintenance-mode state, from cache when fresh enough. Missing or corrupt state fails safe to `DEFAULT_STATE` (INACTIVE). */
export async function getMaintenanceState(prisma: PrismaClient): Promise<MaintenanceModeState> {
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) return cached.state;
  const state = await readStoredState(prisma);
  cached = { state, timestamp: now };
  return state;
}

/** A committed state: the cache takes it directly and every connected client is told over SSE. */
function publish(next: MaintenanceModeState): void {
  cached = { state: next, timestamp: Date.now() };
  sseStore.pushToAll({
    type: 'maintenance-mode',
    status: next.status,
    scheduledAt: next.scheduledAt,
    message: next.message,
  });
}

/** Convenience check for `isBlockedByMaintenance` — avoids exposing the full state shape at call sites that only need a boolean. */
export async function isMaintenanceActive(prisma: PrismaClient): Promise<boolean> {
  const state = await getMaintenanceState(prisma);
  return state.status === 'ACTIVE';
}

/**
 * Whoever bypasses maintenance keeps working through it: `maintenance:update`. Ending it takes
 * `maintenance:mode_manage` as well; today both are `admin`'s alone. A role string that is not a
 * known role holds no permission, so it is blocked.
 */
export function bypassesMaintenance(role: string): boolean {
  // `role` comes from the session or the user row as a plain string; hasPermission answers false
  // for anything outside `Roles`, which is the fail-closed answer wanted here.
  return hasPermission({ role: role as Role }, 'maintenance:update');
}

/**
 * Whether maintenance is `ACTIVE` and `role` cannot bypass it. The one predicate shared by the tRPC
 * guard (`assertNotBlockedByMaintenance`) and the login's post-proof check (`auth.service.ts`),
 * which answers its own `FORBIDDEN 'MAINTENANCE_ACTIVE'` marker.
 */
export async function isBlockedByMaintenance(prisma: PrismaClient, role: string): Promise<boolean> {
  return !bypassesMaintenance(role) && (await isMaintenanceActive(prisma));
}

/**
 * Throws `SERVICE_UNAVAILABLE` if maintenance blocks `role` (`isBlockedByMaintenance`): the tRPC
 * guard (`maintenanceGuard` in trpc.ts) for signed-in traffic.
 */
export async function assertNotBlockedByMaintenance(prisma: PrismaClient, role: string): Promise<void> {
  if (await isBlockedByMaintenance(prisma, role)) throw new ServiceUnavailableError('maintenance');
}

/**
 * Persists the full next state as one AppConfig row, updates the cache directly (no re-read —
 * `next` already *is* the resulting state, encode/decode round-trips exactly), and broadcasts
 * it over SSE so every connected client (and every signed-in poll, on its next tick) picks up the
 * change without waiting out the cache TTL.
 *
 * An unconditional write of the *whole* state: `activateNow`, the restore lockdown and tests. A
 * transition that depends on the current state (`schedule`, `cancelScheduled`, `end`, the scheduler's
 * `markActivated`/`recordWarningsSent`) goes through `transitionMaintenanceState` instead, which
 * re-checks it under the lock (#248).
 */
export async function writeMaintenanceState(prisma: PrismaClient, next: MaintenanceModeState): Promise<MaintenanceModeState> {
  // `saveConfig` takes the AppConfig write lock, so this unconditional write cannot land inside a
  // `transitionMaintenanceState` between its check and its write.
  await saveConfig(prisma, CONFIG_KEY, JSON.stringify(next), false);
  publish(next);
  return next;
}

/**
 * A conditional transition (#248, rule 3): under the AppConfig write lock, reads the stored state
 * uncached and lets `decide` answer the next state, or `null` when the transition no longer applies
 * (another request or tick got there first). Writes it in the same transaction, then publishes it
 * after the commit. Side effects (emails, notices, sign-outs, audit) belong to the caller, after this
 * returns, and only when it returns a transition.
 *
 * @returns The state before and after, or `null` when nothing was written.
 */
export async function transitionMaintenanceState(
  prisma: PrismaClient,
  decide: (current: MaintenanceModeState) => MaintenanceModeState | null
): Promise<{ previous: MaintenanceModeState; next: MaintenanceModeState } | null> {
  const transition = await prisma.$transaction(async tx => {
    await acquireAppConfigWriteLock(tx);
    const previous = await readStoredState(tx);
    const next = decide(previous);
    if (!next) return null;
    await writeConfigsTx(tx, [{ key: CONFIG_KEY, value: JSON.stringify(next), encrypt: false }]);
    return { previous, next };
  });
  if (transition) publish(transition.next);
  return transition;
}

/** Whether `current` is still the schedule `expected` was read from: a cancel or a reschedule makes it another. */
function isSameSchedule(current: MaintenanceModeState, expected: MaintenanceModeState): boolean {
  return current.status === 'SCHEDULED' && current.scheduledAt === expected.scheduledAt;
}

/**
 * Countdown reached zero: flips the schedule `expected` was read from to `ACTIVE`, leaving
 * message/forceLogout/warningLeadMinutes/activatedByUserId exactly as set at schedule time.
 *
 * @returns The activated state, or `null` when that schedule was cancelled or replaced meanwhile.
 */
export async function markActivated(prisma: PrismaClient, expected: MaintenanceModeState): Promise<MaintenanceModeState | null> {
  const transition = await transitionMaintenanceState(prisma, current =>
    isSameSchedule(current, expected) ? { ...current, status: 'ACTIVE', activatedAt: new Date().toISOString() } : null
  );
  return transition?.next ?? null;
}

/**
 * Records that the warning-ladder thresholds in `crossed` have fired for the schedule `expected` was
 * read from, keeping any another tick already recorded.
 *
 * @returns The thresholds newly recorded (empty when that schedule is gone or they were recorded already).
 */
export async function recordWarningsSent(
  prisma: PrismaClient,
  expected: MaintenanceModeState,
  crossed: number[]
): Promise<number[]> {
  const transition = await transitionMaintenanceState(prisma, current => {
    if (!isSameSchedule(current, expected)) return null;
    const fresh = crossed.filter(threshold => !current.warningsSent.includes(threshold));
    return fresh.length > 0 ? { ...current, warningsSent: [...current.warningsSent, ...fresh] } : null;
  });
  // The thresholds appended by this transition, after the ones it found.
  return transition ? transition.next.warningsSent.slice(transition.previous.warningsSent.length) : [];
}

/**
 * Revokes the session of every role that cannot bypass maintenance (`bypassesMaintenance`) in one
 * bulk update, through the same helper as every single-user revocation: each revoked user's cached
 * version is dropped and their open tabs are told at once.
 */
export async function forceLogoutNonAdmins(prisma: PrismaClient): Promise<void> {
  await revokingTransaction(prisma, (_tx, revoke) =>
    revoke.where({ role: { in: Roles.filter(role => !bypassesMaintenance(role)) } })
  );
}

/**
 * Wraps a scheduler's tick function so it's skipped entirely while maintenance mode is `ACTIVE`.
 * Every pre-existing tick-based scheduler (nav/kimo/portafoglio sync, milestone deadlines,
 * calendar digest) applies this at its `setInterval` call site — a future scheduler that does
 * the same is protected by construction, instead of each one independently re-deriving the same
 * `isMaintenanceActive` check inline.
 */
export function guardMaintenance(prisma: PrismaClient, tick: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (await isMaintenanceActive(prisma)) return;
    await tick();
  };
}
