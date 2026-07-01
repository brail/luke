/**
 * Centralised audit-log service.
 * Persists structured audit events to the database with trace correlation,
 * request IP, and automatic metadata sanitisation.
 */

import type { Context } from './trpc';

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
  /** Arbitrary metadata. Keys not on the allowlist are automatically redacted. */
  metadata?: Record<string, any>;
}

// Actions where audit failure must surface — losing these silently is a compliance/security risk
const CRITICAL_AUDIT_ACTIONS = new Set([
  'AUTH_LOGIN_FAILED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_CHANGED',
  'EMAIL_CHANGED',
  'CONFIG_UPSERT',
  'CONFIG_DELETE',
  'USER_HARD_DELETE',
  'SECTION_ACCESS_UPDATED',
  'COLLECTION_LAYOUT_REVISION_CREATE',
]);

const SAFE_KEYS = new Set([
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
  'ownerFunctionId',
]);

/** Returns true if the value was produced by the sanitizer's redaction logic. */
export function isRedactedValue(v: unknown): boolean {
  return typeof v === 'string' && (v.startsWith('[REDACTED') || v === '***REDACTED***');
}

function sanitizeMetadata(obj: any, depth = 0): any {
  // Limite ricorsione (DoS protection)
  if (depth > 5) return '[REDACTED:MAX_DEPTH]';

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeMetadata(item, depth + 1));
  }

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Prima controlla whitelist, poi blacklist
      if (SAFE_KEYS.has(key)) {
        sanitized[key] = sanitizeMetadata(value, depth + 1);
      } else if (/password|token|secret|key|auth|credential|bind/i.test(key)) {
        sanitized[key] = '***REDACTED***';
      } else {
        // Default: redatta chiavi non whitelisted
        if (typeof value === 'string') {
          sanitized[key] = '[REDACTED]';
        } else if (Array.isArray(value)) {
          sanitized[key] = sanitizeMetadata(value, depth + 1);
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeMetadata(value, depth + 1);
        } else {
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
  try {
    // Sanitizza i metadati per rimuovere campi sensibili
    const sanitizedMetadata = params.metadata
      ? sanitizeMetadata(params.metadata)
      : undefined;

    // Crea record AuditLog con nuovo schema
    await ctx.prisma.auditLog.create({
      data: {
        actorId: ctx.session?.user?.id || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId || null,
        result: params.result || 'SUCCESS',
        metadata: sanitizedMetadata,
        traceId: ctx.traceId,
        ip: ctx.req.ip || null,
      },
    });

    // Log con Pino per correlazione
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

// Helper specifici rimossi - tutto centralizzato in logAudit() per DRY
// Usa direttamente logAudit() con i nuovi parametri standardizzati
