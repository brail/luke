/**
 * Service layer per AuditLog
 * Gestisce logging centralizzato con delta changes e traceId
 */

import type { Context } from './trpc';

/**
 * Parametri per logging audit
 */
export interface AuditParams {
  /** Azione eseguita (SCREAMING_SNAKE_CASE: es. 'USER_CREATE', 'AUTH_LOGIN') */
  action: string;
  /** Tipo di risorsa (User, Config, Auth) */
  targetType: string;
  /** ID della risorsa target dell'operazione (opzionale) */
  targetId?: string;
  /** Risultato dell'operazione (default: SUCCESS) */
  result?: 'SUCCESS' | 'FAILURE';
  /** Metadati aggiuntivi (saranno redatti automaticamente) */
  metadata?: Record<string, any>;
}

/**
 * Chiavi sicure per metadata (whitelist approach)
 * Approccio secure-by-default: solo questi campi sono considerati safe
 */
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
]);

/**
 * Redazione ricorsiva dei metadati con whitelist + blacklist
 * Approccio secure-by-default: redatta tutto tranne whitelist + blacklist esplicita
 */
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
 * Logga un evento di audit nel database
 * @param ctx - Context tRPC con traceId
 * @param params - Parametri dell'audit
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
    // Log errore ma non bloccare l'operazione principale
    ctx.req.log.error({
      traceId: ctx.traceId,
      error: error instanceof Error ? error.message : 'Unknown',
      action: params.action,
      message: 'Failed to log audit event',
    });
  }
}

// Helper specifici rimossi - tutto centralizzato in logAudit() per DRY
// Usa direttamente logAudit() con i nuovi parametri standardizzati
