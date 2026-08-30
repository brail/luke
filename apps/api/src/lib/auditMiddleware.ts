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
    // Mutations only (queries don't need audit)
    if (type !== 'mutation') {
      return next();
    }

    try {
      const result = await next();

      // SUCCESS: extract targetId if present in result or input
      const resultData =
        result && typeof result === 'object' && 'data' in result
          ? (result as { data: unknown }).data
          : undefined;
      const targetId = extractId(resultData) || extractId(result) || extractId(input);

      await logAudit(ctx, {
        action,
        targetType,
        targetId,
        result: 'SUCCESS',
        // The mutation's input and output under two container keys, written out so
        // `AuditMetadata` checks them; their children are dynamic by design and are checked at
        // runtime by `sanitizeMetadata`. That split is the contract.
        //
        // There is deliberately no field list here. This used to keep a second, hand-maintained
        // allowlist of 9 input and 7 result fields, which failed twice over: most mutations have
        // none of those fields, so the row was stored as `{}`, and the `input_`/`result_` prefixes
        // it added were not on `SAFE_KEY_LIST`, so whatever it did capture was redacted anyway
        // (`USER_UPDATE` rows read `{"input_role": "[REDACTED]"}`). `sanitizeMetadata` is the one
        // allowlist; nesting keeps `input.role` and `result.role` distinguishable without prefixes.
        //
        // `resultData`, not `result`: the latter is tRPC's middleware envelope, which carries
        // `ctx` (Prisma client, Fastify request) and is circular — persisting it fails the
        // Prisma insert, and `logAudit` swallows that for non-critical actions, so the audit
        // row silently disappears instead of being merely incomplete.
        metadata: {
          input: input && typeof input === 'object' ? input : undefined,
          result: resultData && typeof resultData === 'object' ? resultData : undefined,
        },
      });

      return result;
    } catch (error: unknown) {
      // FAILURE: logs error without PII
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

      throw error; // Re-throw to not block flow
    }
  });
}
