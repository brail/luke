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

import { TRPCError } from '@trpc/server';

import { MaintenanceModeStateSchema, type MaintenanceModeState } from '@luke/core';

import { getConfig, saveConfig } from './configManager';
import { sseStore } from './sseStore';
import { clearTokenVersionCache } from './tokenVersionCache';

import type { PrismaClient } from '@prisma/client';

export type { MaintenanceModeState, MaintenanceModeStatus } from '@luke/core';

const CONFIG_KEY = 'maintenance.mode.state';

const DEFAULT_STATE: MaintenanceModeState = {
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

/** Reads the current maintenance-mode state, from cache when fresh enough. Missing or corrupt state fails safe to `DEFAULT_STATE` (INACTIVE). */
export async function getMaintenanceState(prisma: PrismaClient): Promise<MaintenanceModeState> {
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL_MS) return cached.state;

  const raw = await getConfig(prisma, CONFIG_KEY, false);
  let state = DEFAULT_STATE;
  if (raw) {
    try {
      state = MaintenanceModeStateSchema.parse(JSON.parse(raw));
    } catch {
      state = DEFAULT_STATE;
    }
  }

  cached = { state, timestamp: now };
  return state;
}

/** Convenience check for the enforcement guard (trpc middleware, login) — avoids exposing the full state shape at call sites that only need a boolean. */
export async function isMaintenanceActive(prisma: PrismaClient): Promise<boolean> {
  const state = await getMaintenanceState(prisma);
  return state.status === 'ACTIVE';
}

/**
 * Throws `SERVICE_UNAVAILABLE` if maintenance mode is `ACTIVE` and `role` isn't admin. The one
 * enforcement predicate shared by the tRPC guard (`maintenanceGuard` in trpc.ts) and the login
 * flow (`auth.service.ts`) — two independent copies of this same check would silently drift the
 * next time either changes (e.g. an admin-adjacent role gets added).
 */
export async function assertNotBlockedByMaintenance(prisma: PrismaClient, role: string): Promise<void> {
  if (role !== 'admin' && await isMaintenanceActive(prisma)) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Sistema in manutenzione. Riprova più tardi.',
    });
  }
}

/**
 * Persists the full next state as one AppConfig row, updates the cache directly (no re-read —
 * `next` already *is* the resulting state, encode/decode round-trips exactly), and broadcasts
 * it over SSE so every connected client (including the login screen's poll-only fallback, on
 * its next tick) picks up the change without waiting out the cache TTL.
 *
 * Takes the *whole* state rather than a partial patch: every router mutation (`schedule`,
 * `activateNow`, `cancelScheduled`, `end`) already builds a complete state object, and the two
 * scheduler call sites that only touch one or two fields go through `markActivated`/
 * `recordWarningsSent` below, which read-merge-write internally instead of pushing partial-patch
 * plumbing into this function.
 */
export async function writeMaintenanceState(prisma: PrismaClient, next: MaintenanceModeState): Promise<MaintenanceModeState> {
  await saveConfig(prisma, CONFIG_KEY, JSON.stringify(next), false);

  cached = { state: next, timestamp: Date.now() };

  sseStore.pushToAll({
    type: 'maintenance-mode',
    status: next.status,
    scheduledAt: next.scheduledAt,
    message: next.message,
  });

  return next;
}

/** Countdown reached zero: flips to `ACTIVE`, leaving message/forceLogout/warningLeadMinutes/activatedByUserId exactly as set at schedule time. */
export async function markActivated(prisma: PrismaClient, current: MaintenanceModeState): Promise<MaintenanceModeState> {
  return writeMaintenanceState(prisma, { ...current, status: 'ACTIVE', activatedAt: new Date().toISOString() });
}

/** Records that the warning-ladder thresholds in `newlySent` have now fired, without touching anything else. */
export async function recordWarningsSent(prisma: PrismaClient, current: MaintenanceModeState, newlySent: number[]): Promise<MaintenanceModeState> {
  return writeMaintenanceState(prisma, { ...current, warningsSent: [...current.warningsSent, ...newlySent] });
}

/**
 * Revokes every non-admin session in one bulk update (same mechanism as the existing
 * single-user force-logout in `users.admin.router.ts`, just role-scoped instead of id-scoped),
 * then clears the whole tokenVersion cache so it takes effect immediately rather than waiting
 * out each entry's TTL.
 */
export async function forceLogoutNonAdmins(prisma: PrismaClient): Promise<void> {
  await prisma.user.updateMany({
    where: { role: { not: 'admin' } },
    data: { tokenVersion: { increment: 1 } },
  });
  clearTokenVersionCache();
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
