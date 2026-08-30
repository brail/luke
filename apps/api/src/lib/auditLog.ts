/**
 * Centralised audit-log service.
 * Persists structured audit events to the database with trace correlation,
 * request IP, and automatic metadata sanitisation. Also the shared home for reading it back —
 * `buildAuditLogWhere`/`auditActorName` are used by both the `auditLog` tRPC router and the raw
 * `/download/audit-log` CSV route, so neither has to import from the other.
 */

import { fullName, type AuditLogFilters } from '@luke/core';

import type { Context } from './trpc';
import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Parameters for a single audit log entry.
 */
export interface AuditParams {
  /** Action identifier in SCREAMING_SNAKE_CASE (e.g. 'USER_CREATE', 'AUTH_LOGIN'). */
  action: string;
  /** Domain entity type affected (e.g. 'User', 'Config', 'Auth'). */
  targetType: string;
  /** Primary key of the affected entity, if applicable. */
  targetId?: string;
  /** Outcome of the operation. Defaults to 'SUCCESS'. */
  result?: 'SUCCESS' | 'FAILURE';
  /**
   * Supplemental data. Typed against `SAFE_KEY_LIST` so an unlisted key fails the build at
   * the call site instead of being silently stored as `[REDACTED]` — nested keys are still
   * only checked at runtime by `sanitizeMetadata`.
   */
  metadata?: AuditMetadata;
}

// Actions where audit failure must surface — losing these silently is a compliance/security risk.
// Also the retention-sweep floor (retentionScheduler.ts): rows with these actions get the longer
// `auditLog.criticalRetentionDays` window instead of `auditLog.retentionDays`.
export const CRITICAL_AUDIT_ACTIONS = new Set([
  'AUTH_LOGIN_FAILED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_CHANGED',
  'USER_PASSWORD_RESET_BY_ADMIN',
  'EMAIL_CHANGED',
  'CONFIG_UPSERT',
  'CONFIG_DELETE',
  'USER_HARD_DELETE',
  'SECTION_ACCESS_UPDATED',
  'COLLECTION_LAYOUT_REVISION_CREATE',
  'BACKUP_RESTORE',
  'BACKUP_EXPORT',
  'BACKUP_IMPORT',
  'BACKUP_MIGRATION_BRIDGE',
  'MAINTENANCE_MODE_ACTIVATED',
]);

/**
 * The single allowlist of audit metadata keys, in declaration order by domain.
 *
 * `as const` on purpose: `AuditMetadataKey` is derived from it, so `logAudit({ metadata })`
 * stops compiling when a call site invents a key. Before that link existed the list drifted
 * behind the call sites and ~34% of stored rows were `[REDACTED]` noise on harmless fields.
 * Adding a key here is a deliberate decision that it is safe to persist in the audit trail.
 */
const SAFE_KEY_LIST = [
  'username',
  'email',
  'role',
  'action',
  'timestamp',
  'provider',
  'success',
  'reason',
  'key',
  'isEncrypted',
  'locale',
  'timezone',
  'firstName',
  'lastName',
  'isActive',
  'strategy',
  'userAgent',
  'createdAt',
  'updatedAt',
  'completedAt',
  'lastLoginAt',
  'loginCount',
  'id',
  'count',
  'targetUserId',
  'section',
  'enabled',
  'filename',
  'contentType',
  'code',
  'logoKey',
  'brandId',
  'seasonId',
  'vendorId',
  'collectionId',
  'rowId',
  'parameterId',
  'pricingSetId',
  'configKey',
  'hasBindPassword',
  'name',
  'configKeys',
  'ldapEnabled',
  'previousNavVendorId',
  'errorCode',
  'collectionLayoutId',
  'oldPhaseId',
  'newPhaseId',
  'phaseChangeNote',
  'completionNote',
  'completionForced',
  'skippedPhases',
  'planningGroupId',
  'oldPlanningGroupId',
  'newPlanningGroupId',
  'revisionNumber',
  'revisionTypeValue',
  'cause',
  'milestoneId',
  'rowsIncluded',
  'title',
  'status',
  'calendarId',
  'visibleUserIds',
  'snapshots',
  'templateId',
  'startAt',
  'endAt',
  'oldStartAt',
  'newStartAt',
  'oldEndAt',
  'newEndAt',
  'allDay',
  // `rescheduleMilestone` writes these when a move flips the all-day flag; both used to land as
  // `[REDACTED]`.
  //
  // Worth knowing why the type guard did not catch it, because the hole is wider than these two
  // keys: excess-property checking only applies to properties written *literally* in the object.
  // Every spread form escapes it — `...(cond && { … })`, `...(cond ? { … } : {})`, `...someVar` —
  // and `metadata` passed as a bare variable (`seasonCalendar.triggerSync`, `auditMiddleware`) is
  // not checked at all. `AuditMetadata` still earns its place for the literal case; it just is not
  // the backstop the absence of a runtime error might suggest.
  'oldAllDay',
  'newAllDay',
  'oldStatus',
  'changedFields',
  'safetySnapshotId',
  'scope',
  'trigger',
  'preserveAuditLog',
  'restoreFiles',
  'dailyTime',
  'retentionDays',
  'retentionMinCount',
  'notifyOnFailure',
  'scheduledAt',
  'forceLogout',
  'warningLeadMinutes',
  'migratedBackupId',
  'migrationsApplied',

  // --- Recovered 2026-08-27: keys that call sites had been passing all along while the list
  // stood still, so they were persisted as "[REDACTED]". Grouped by domain; the type link
  // below is what stops this block from drifting again.

  // Structural containers written by `withAuditLog` — their children are filtered normally.
  'input',
  'result',

  // Entity references
  'userId',
  'teamId',
  'eventId',
  'groupId',
  'planId',
  'imageId',
  'specsheetId',
  'functionId',
  'sourceRowId',
  'sourceBrandId',
  'sourceSeasonId',
  'sourcePlanningGroupIds',
  'fromBrandId',
  'fromSeasonId',
  'toBrandId',
  'toSeasonId',
  'previousNavBrandId',
  'previousNavSeasonId',
  'orderedIds',
  'oldLogoKey',

  // Generic descriptors of the affected entity
  'type',
  'mode',
  'value',
  'label',
  'slug',
  'source',
  'entity',
  'done',
  'year',
  'method',
  'verifiedAt',
  'expiresAt',
  'newTimezone',

  // Identity of the affected account. PII, deliberately kept: an audit trail that cannot say
  // *who* was deleted or reset is not an audit trail. Audit reads require `audit:read_all`.
  'userEmail',
  'deletedUsername',
  'deletedEmail',
  'deletedRole',
  'resetBy',
  'emailChanged',
  'sessionsInvalidated',

  // Counters and outcomes of batch operations
  'rowCount',
  'amendedCount',
  'bandCount',
  'navNosCount',
  'durationMs',
  'results',
  'imported',
  'synced',
  'overriddenPhases',
  'countryCodes',
  'countryCode',
  'errors',

  // Free-text failure details. Allowlisted but scrubbed by value, see FREE_TEXT_KEYS.
  'error',
  'errorMessage',

  // Storage / uploads
  'bucket',
  'size',
  'originalName',
  'originalFilename',
  'logoChanged',

  // Integration connection settings (NAV, SMTP, Google). The connection identity is exactly
  // what an admin auditing a config change needs; the credential itself is never passed here.
  'host',
  'port',
  'secure',
  'database',
  'user',
  'company',
  'domain',
  'readOnly',
  'connectionChanged',
  'autoSyncEnabled',
  'calendarSyncEnabled',
  'intervalMinutes',
  // Both of these shadow the sensitive-key blacklist below and are allowlisted on purpose:
  // `passwordUpdated` is a boolean "was it rotated", `authMode` is a strategy name
  // ('oauth' | 'service_account'). Neither ever carries the secret itself.
  'passwordUpdated',
  'authMode',

  // Config / RBAC
  'valueRedacted',
  'includeValues',
  'sectionAccessDefaults',
] as const;

/** A key that may be persisted in `AuditLog.metadata`. */
export type AuditMetadataKey = (typeof SAFE_KEY_LIST)[number];

/** Shape accepted by `logAudit`: only allowlisted keys, any JSON-serialisable value. */
export type AuditMetadata = Partial<Record<AuditMetadataKey, unknown>>;

const SAFE_KEYS = new Set<string>(SAFE_KEY_LIST);

/**
 * Allowlisted keys whose value is an operator-facing free-text message rather than a known
 * field. An exception string can embed a connection string or a `password=...` pair, so the
 * value — not just the key — is scrubbed and capped before it reaches the audit trail.
 */
const FREE_TEXT_KEYS = new Set<string>(['error', 'errorMessage', 'message']);

const FREE_TEXT_MAX_LENGTH = 200;

/** Blacklist: a key that looks like a secret is redacted wherever it appears. */
const SENSITIVE_KEY_PATTERN = /password|token|secret|key|auth|credential|bind/i;

/** Masks credentials embedded in a free-text message: URL userinfo and `secret=value` pairs. */
function scrubFreeText(value: string): string {
  return value
    .replace(/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@')
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key)\b(\s*[=:]\s*)\S+/gi, '$1$2***')
    .slice(0, FREE_TEXT_MAX_LENGTH);
}

/** Returns true if the value was produced by the sanitizer's redaction logic. */
export function isRedactedValue(v: unknown): boolean {
  return typeof v === 'string' && (v.startsWith('[REDACTED') || v === '***REDACTED***');
}

/**
 * Records a key whose value the allowlist is about to drop.
 *
 * `AuditMetadata` types `logAudit`'s parameter, but TypeScript's excess-property check only sees
 * properties written literally: `metadata: syncResult`, `metadata: { ...input }` and every
 * `...(cond && { … })` walk straight past it, and the sanitizer then stores `[REDACTED]` without
 * anyone being told. This is the only mechanism that sees those forms, because it runs on the
 * object that actually reaches the database.
 *
 * Outside production this throws, so the drift fails a test run instead of surfacing months later
 * in a column nobody reads. Production keeps redacting silently — the behaviour the audit trail
 * already has, and not something to change from inside an error path.
 */
let unlistedKeyCollector: ((path: string) => void) | null = null;

/**
 * Collects offending paths instead of throwing, for the length of one run.
 *
 * This is how the existing violations were enumerated before the throw was armed, and how the
 * next batch gets enumerated: a red suite stops at the first violation and hides the rest, so a
 * census has to come before a gate. A seam rather than an env var because a new `process.env`
 * read is exactly what the Env Policy forbids, and a diagnostic is a poor reason to bend it.
 *
 * @returns A function that uninstalls the collector. Always call it — a leaked collector turns
 * the gate off for every test that follows.
 */
export function collectUnlistedAuditKeys(collector: (path: string) => void): () => void {
  unlistedKeyCollector = collector;
  return () => {
    unlistedKeyCollector = null;
  };
}

function reportUnlistedKey(path: string): void {
  if (unlistedKeyCollector) {
    unlistedKeyCollector(path);
    return;
  }
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(
      `Audit metadata: '${path}' is not in SAFE_KEY_LIST and would be stored as [REDACTED]. ` +
        'Either add it there — a deliberate decision that it is safe to persist — or stop passing it. ' +
        'See apps/api/src/lib/auditLog.ts.',
    );
  }
}

/** Path of a nested key, for a census entry that says which call site to look at. */
function joinPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * Keys whose value is a *map* — its keys are data, not field names.
 *
 * The allowlist model assumes every object is a struct whose keys were chosen by a developer.
 * `sectionAccessDefaults` is `Record<Role, Record<Section, Access>>`, so walking it as a struct
 * asks the allowlist to vouch for three role names and ninety-odd section names. It cannot, so
 * every leaf of a `CONFIG_UPSERT` on `rbac.sectionAccessDefaults` — a `CRITICAL_AUDIT_ACTIONS`
 * action — has been stored as `[REDACTED]`: the trail recorded that the RBAC defaults changed,
 * never what they changed to. Listing the section names would fix it until the next section is
 * added, and CLAUDE.md already asks for three places to be updated then, not four.
 *
 * Typed as `AuditMetadataKey`, so a key here must first be on `SAFE_KEY_LIST` — this says how to
 * walk a value that is already allowed, it never admits one that isn't.
 */
const MAP_VALUED_KEYS = new Set<string>(
  ['sectionAccessDefaults'] satisfies readonly AuditMetadataKey[],
);

/**
 * Walks a map: keeps the keys, sanitises the values.
 *
 * The blacklist still applies to the keys — a map key that looks like `password` is redacted
 * wherever it appears — and nested objects stay in map mode, because a nested map's keys are
 * data for the same reason its parent's are.
 */
function sanitizeMapValues(obj: object, depth: number, path: string): unknown {
  if (depth > 5) return '[REDACTED:MAX_DEPTH]';

  if (Array.isArray(obj)) {
    return obj.map((item, i) =>
      item && typeof item === 'object' ? sanitizeMapValues(item, depth + 1, `${path}[${i}]`) : item,
    );
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '***REDACTED***';
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeMapValues(value, depth + 1, joinPath(path, key));
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Elements of an array held by a key that is *not* on the allowlist.
 *
 * Objects keep being filtered by their own keys, but a bare primitive is redacted: nothing
 * vouched for it. Handing the whole array to `sanitizeMetadata` instead let every primitive
 * fall through to its `return obj` for primitives without the holding key ever being checked,
 * so `{ errors: ['...'] }` was stored in clear while a plain string under the same key was not.
 */
function sanitizeUnvouchedArray(arr: unknown[], depth: number, path: string): unknown[] {
  return arr.map((item, i) =>
    item && typeof item === 'object'
      ? sanitizeMetadata(item, depth, `${path}[${i}]`)
      : '[REDACTED]',
  );
}

/**
 * Recursive metadata redaction: whitelist first, blacklist second.
 *
 * Exported for tests. `auditlog.redaction.spec.ts` used to keep a pasted-in
 * copy, which had already drifted in an inverted way — it checked the blacklist
 * first and had 24 keys instead of 79 — so the entire redaction suite was
 * asserting a behaviour production doesn't have.
 *
 * `path` is carried for the benefit of `reportUnlistedKey`: a bare key name is not enough to
 * find the call site when the key is three levels inside a captured procedure input.
 */
export function sanitizeMetadata(obj: unknown, depth = 0, path = ''): unknown {
  // Recursion limit (DoS protection)
  if (depth > 5) return '[REDACTED:MAX_DEPTH]';

  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeMetadata(item, depth + 1, `${path}[${i}]`));
  }

  // Before the generic object branch: `Object.entries(new Date())` is empty, so a Date walked
  // as a plain object is persisted as `{}`. Entity timestamps reach here now that the
  // middleware records the procedure's input and result.
  if (obj instanceof Date) return obj.toISOString();

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // A key that does not apply to this event is absent, not null. This is what lets a call site
      // write `oldStartAt: dateChanged ? … : undefined` — keys literal, so `AuditMetadata` checks
      // them — instead of `...(dateChanged && { oldStartAt: … })`, whose keys the type cannot see.
      if (value === undefined) continue;

      // Check whitelist first, then blacklist
      if (FREE_TEXT_KEYS.has(key)) {
        sanitized[key] = typeof value === 'string' ? scrubFreeText(value) : '[REDACTED]';
      } else if (MAP_VALUED_KEYS.has(key) && value && typeof value === 'object') {
        sanitized[key] = sanitizeMapValues(value, depth + 1, joinPath(path, key));
      } else if (SAFE_KEYS.has(key)) {
        sanitized[key] = sanitizeMetadata(value, depth + 1, joinPath(path, key));
      } else if (SENSITIVE_KEY_PATTERN.test(key)) {
        // The blacklist firing is the design working, not drift: never reported.
        sanitized[key] = '***REDACTED***';
      } else {
        // Default: redact non-allowlisted keys
        if (Array.isArray(value)) {
          sanitized[key] = sanitizeUnvouchedArray(value, depth + 1, joinPath(path, key));
        } else if (value && typeof value === 'object') {
          // Nothing is lost here — the children are filtered by their own keys — so there is
          // nothing to report either.
          sanitized[key] = sanitizeMetadata(value, depth + 1, joinPath(path, key));
        } else {
          // The silent drop the allowlist was supposed to make loud.
          reportUnlistedKey(joinPath(path, key));
          sanitized[key] = '[REDACTED]';
        }
      }
    }
    return sanitized;
  }

  return obj; // Primitives safe
}

/**
 * Persists an audit event to the database and emits a structured Pino log entry.
 * Metadata is sanitised before storage; keys matching sensitive patterns are redacted.
 * For actions in `CRITICAL_AUDIT_ACTIONS`, any DB write failure is re-thrown
 * rather than swallowed, surfacing the compliance risk to the caller.
 *
 * @param ctx - tRPC context supplying Prisma, session, traceId, and request IP.
 * @param params - Audit event details.
 * @throws If the DB write fails and the action is considered critical.
 */
export async function logAudit(
  ctx: Context,
  params: AuditParams
): Promise<void> {
  // Outside the try on purpose. Everything below it is I/O, whose failure is swallowed for
  // non-critical actions; a key missing from `SAFE_KEY_LIST` is a programming error, and letting
  // it be caught there would turn the gate into a log line nobody reads — exactly the silence it
  // exists to break.
  const sanitizedMetadata = params.metadata ? sanitizeMetadata(params.metadata) : undefined;

  try {
    // Create AuditLog record with the new schema
    await ctx.prisma.auditLog.create({
      data: {
        actorId: ctx.session?.user?.id || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId || null,
        result: params.result || 'SUCCESS',
        metadata: sanitizedMetadata as Prisma.InputJsonValue | undefined, // sanitizeMetadata only ever returns JSON-safe primitives/objects/arrays
        traceId: ctx.traceId,
        ip: ctx.req.ip || null,
      },
    });

    // Log with Pino for correlation
    ctx.req.log.info({
      traceId: ctx.traceId,
      action: params.action,
      targetType: params.targetType,
      result: params.result || 'SUCCESS',
      message: `Audit: ${params.action}`,
    });
  } catch (error) {
    ctx.req.log.error({
      traceId: ctx.traceId,
      error: error instanceof Error ? error.message : 'Unknown',
      action: params.action,
      message: 'Failed to log audit event',
    });
    if (CRITICAL_AUDIT_ACTIONS.has(params.action)) {
      throw error;
    }
  }
}

// Entity-specific helpers removed - everything centralized in logAudit() for DRY
// Use logAudit() directly with the new standardized parameters

/** Translates audit log page/export filters into a Prisma where clause — shared by `auditLog.list` and the `/download/audit-log` CSV route. */
export function buildAuditLogWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput {
  return {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.action ? { action: { contains: filters.action, mode: 'insensitive' } } : {}),
    ...(filters.targetType ? { targetType: { contains: filters.targetType, mode: 'insensitive' } } : {}),
    ...(filters.result ? { result: filters.result } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          createdAt: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
          },
        }
      : {}),
  };
}

/**
 * Target types whose `targetId` is a `User.id`. Only entries of these types can be attributed
 * to a person when the actor is missing — anything else with a null actor is a genuine
 * system/script event and must keep rendering as such.
 */
const USER_SUBJECT_TARGET_TYPES = new Set(['Auth', 'User']);

/** The person an actor-less audit entry is *about*, as opposed to the (absent) authenticated actor. */
export interface AuditSubject {
  /** Full name of the resolved user, or the raw username when no account exists (failed login on an unknown user). */
  name: string | null;
  email: string | null;
}

const NO_SUBJECT: AuditSubject = { name: null, email: null };

/** Minimal shape needed to attribute an entry — accepted so callers can pass a full row or a narrow select. */
interface AuditSubjectSource {
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
}

/**
 * Batch-resolves the subjects of the actor-less entries in a page of audit logs.
 *
 * `logAudit` takes the actor from `ctx.session`, which does not exist yet during login,
 * email verification or password reset — so those rows store `actorId: null` and would
 * otherwise render as an anonymous "Sistema". The identity is not lost: those flows set
 * `targetId` to the `User.id`. One batched query per page recovers it, retroactively for
 * rows already written, without touching the schema.
 */
export async function resolveAuditSubjects(
  prisma: Pick<PrismaClient, 'user'>,
  entries: AuditSubjectSource[]
): Promise<Map<string, AuditSubject>> {
  const ids = [
    ...new Set(
      entries
        .filter(e => !e.actorId && e.targetId && USER_SUBJECT_TARGET_TYPES.has(e.targetType))
        .map(e => e.targetId as string)
    ),
  ];
  if (ids.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, username: true, email: true },
  });
  return new Map(users.map(u => [u.id, { name: fullName(u), email: u.email }]));
}

/**
 * Subject of a single entry, given the map from `resolveAuditSubjects`.
 * Falls back to `metadata.username` for the one case with no user row to point at:
 * a failed login against an account that does not exist.
 * Returns an empty subject when the entry has a real actor — the actor is the attribution then.
 */
export function auditSubjectOf(entry: AuditSubjectSource, subjects: Map<string, AuditSubject>): AuditSubject {
  if (entry.actorId) return NO_SUBJECT;

  const resolved = entry.targetId ? subjects.get(entry.targetId) : undefined;
  if (resolved) return resolved;

  const username =
    entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? (entry.metadata as Record<string, unknown>).username
      : undefined;
  return typeof username === 'string' && !isRedactedValue(username)
    ? { name: username, email: null }
    : NO_SUBJECT;
}

/** "First Last" (falling back to username) for an audit log actor — null when the actor itself is null (system action, or the user was hard-deleted). */
export function auditActorName(actor: { firstName: string; lastName: string; username: string } | null): string | null {
  return actor ? fullName(actor) : null;
}
