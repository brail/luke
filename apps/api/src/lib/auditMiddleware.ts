/**
 * Middleware tRPC per AuditLog centralizzato
 * Gestisce automaticamente logging SUCCESS/FAILURE per tutte le mutation
 */

import { logAudit } from './auditLog';
import { t } from './trpc';

/**
 * Middleware per logging automatico di audit
 * @param action - Azione in SCREAMING_SNAKE_CASE (es. 'USER_CREATE')
 * @param targetType - Tipo risorsa (User, Config, Auth)
 * @returns Middleware tRPC
 */
export function withAuditLog(action: string, targetType: string) {
  return t.middleware(async ({ ctx, next, type, input }) => {
    // Solo mutation (query non hanno bisogno di audit)
    if (type !== 'mutation') {
      return next();
    }

    try {
      const result = await next();

      // SUCCESS: estrai targetId se presente nel result o input
      const targetId =
        (result as any)?.data?.id ||
        (result as any)?.id ||
        (input as any)?.id ||
        undefined;

      // Estrai metadata safe da input/result
      const safeMetadata = extractSafeMetadata(input, result);

      await logAudit(ctx, {
        action,
        targetType,
        targetId,
        result: 'SUCCESS',
        metadata: safeMetadata,
      });

      return result;
    } catch (error) {
      // FAILURE: logga errore senza PII
      const targetId = (input as any)?.id || undefined;

      await logAudit(ctx, {
        action,
        targetType,
        targetId,
        result: 'FAILURE',
        metadata: {
          errorCode: (error as any).code || 'UNKNOWN',
          errorMessage: (error as any).message?.substring(0, 100), // Truncate
        },
      });

      throw error; // Re-throw per non bloccare flusso
    }
  });
}

/**
 * Estrae metadata sicuri da input e result
 * Evita di loggare dati sensibili
 */
function extractSafeMetadata(input: any, result: any): Record<string, any> {
  const metadata: Record<string, any> = {};

  // Da input: solo campi sicuri
  if (input && typeof input === 'object') {
    const safeInputFields = [
      'username',
      'email',
      'role',
      'locale',
      'timezone',
      'key',
      'isEncrypted',
      'firstName',
      'lastName',
    ];
    for (const field of safeInputFields) {
      if (input[field] !== undefined) {
        metadata[`input_${field}`] = input[field];
      }
    }
  }

  // Da result: solo campi sicuri
  if (result && typeof result === 'object') {
    const safeResultFields = [
      'id',
      'username',
      'email',
      'role',
      'isActive',
      'createdAt',
      'updatedAt',
    ];
    for (const field of safeResultFields) {
      if (result[field] !== undefined) {
        metadata[`result_${field}`] = result[field];
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : {};
}
