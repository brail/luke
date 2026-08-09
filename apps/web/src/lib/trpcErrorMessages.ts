/**
 * Utilities for mapping tRPC and HTTP errors to user-facing messages.
 * Provides a shared set of default messages and supports per-entity overrides,
 * eliminating duplicated error-handling code across mutation callbacks.
 */

const HTTP_STATUS_TO_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

const DEFAULT_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Non hai i permessi per eseguire questa operazione',
  UNAUTHORIZED: 'Sessione scaduta, rieffettua il login',
};

interface TrpcErrorLike {
  message?: string;
  data?: { code?: string };
  status?: number;
}

/**
 * Maps a tRPC or HTTP error to a localised user-facing message.
 * Resolution order: entity override → `BAD_REQUEST` (uses error message) →
 * shared default → raw error message → generic fallback.
 *
 * @param error - Unknown error value (internally cast to `TrpcErrorLike`).
 * @param entityMessages - Optional per-code overrides, e.g. `{ CONFLICT: 'Already exists' }`.
 *   Pass `true` instead of a string to show the server's own `error.message` for that code
 *   instead of the shared default — use only where the endpoint's throw sites are known to
 *   produce user-facing text for that code (e.g. `lastAdminGuard`'s FORBIDDEN messages),
 *   since the shared FORBIDDEN default exists specifically to hide `requirePermission()`'s
 *   internal message (`"Accesso negato: richieste permissions ..."`).
 * @returns A human-readable string ready to display in a toast or form error.
 */
export function getTrpcErrorMessage(
  error: unknown,
  entityMessages?: Record<string, string | true>
): string {
  const e = error as TrpcErrorLike;
  const code: string | undefined =
    e.data?.code ??
    (e.status != null ? HTTP_STATUS_TO_CODE[e.status] : undefined);

  if (!code) return e.message ?? "Errore durante l'operazione. Riprova.";

  const override = entityMessages?.[code];
  if (override === true) return e.message ?? DEFAULT_MESSAGES[code] ?? "Errore durante l'operazione. Riprova.";
  if (override) return override;
  if (code === 'BAD_REQUEST') return e.message ?? 'Dati non validi';
  if (DEFAULT_MESSAGES[code]) return DEFAULT_MESSAGES[code];

  return e.message ?? "Errore durante l'operazione. Riprova.";
}
