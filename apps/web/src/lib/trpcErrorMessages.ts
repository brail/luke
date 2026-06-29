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
 * @returns A human-readable string ready to display in a toast or form error.
 */
export function getTrpcErrorMessage(
  error: unknown,
  entityMessages?: Record<string, string>
): string {
  const e = error as TrpcErrorLike;
  const code: string | undefined =
    e.data?.code ??
    (e.status != null ? HTTP_STATUS_TO_CODE[e.status] : undefined);

  if (!code) return e.message ?? "Errore durante l'operazione. Riprova.";

  if (entityMessages?.[code]) return entityMessages[code];
  if (code === 'BAD_REQUEST') return e.message ?? 'Dati non validi';
  if (DEFAULT_MESSAGES[code]) return DEFAULT_MESSAGES[code];

  return e.message ?? "Errore durante l'operazione. Riprova.";
}
