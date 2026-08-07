/**
 * tRPC middleware for centralised audit logging.
 * Automatically records SUCCESS or FAILURE for every mutation that uses it.
 */

import { logAudit } from './auditLog';
import { toErrorCode, toErrorMessage } from './error';
import { t } from './trpc';

/** Best-effort extraction of a string `id` field from a value of unknown shape. */
function extractId(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/**
 * Creates a tRPC middleware that automatically logs audit events for mutations.
 * Query procedures are passed through without any audit entry.
 * On success the `targetId` is extracted from the result or input; on failure
 * only the error code and a truncated message are recorded (no PII).
 *
 * @param action - Action identifier in SCREAMING_SNAKE_CASE (e.g. 'USER_CREATE').
 * @param targetType - Domain entity type affected (e.g. 'User', 'Config').
 * @returns tRPC middleware.
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
      const resultData =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data: unknown }).data
          : undefined;
      const targetId = extractId(resultData) || extractId(result) || extractId(input);

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
    } catch (error: unknown) {
      // FAILURE: logga errore senza PII
      const targetId = extractId(input);

      await logAudit(ctx, {
        action,
        targetType,
        targetId,
        result: 'FAILURE',
        metadata: {
          errorCode: toErrorCode(error),
          errorMessage: toErrorMessage(error).substring(0, 100), // Truncate
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
function extractSafeMetadata(input: unknown, result: unknown): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  // Da input: solo campi sicuri
  if (input && typeof input === 'object') {
    const inputRecord = input as Record<string, unknown>;
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
      if (inputRecord[field] !== undefined) {
        metadata[`input_${field}`] = inputRecord[field];
      }
    }
  }

  // Da result: solo campi sicuri
  if (result && typeof result === 'object') {
    const resultRecord = result as Record<string, unknown>;
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
      if (resultRecord[field] !== undefined) {
        metadata[`result_${field}`] = resultRecord[field];
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : {};
}
