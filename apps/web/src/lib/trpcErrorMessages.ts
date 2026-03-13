/**
 * Utility per messaggi di errore tRPC/HTTP uniformi
 * DRY: centralizza i messaggi comuni, permette override per entità specifica
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

/**
 * Mappa un errore tRPC/HTTP a un messaggio user-friendly in italiano
 *
 * @param error - Errore tRPC o HTTP
 * @param entityMessages - Override per codici specifici dell'entità (es. CONFLICT, NOT_FOUND)
 * @returns Messaggio localizzato
 */
export function getTrpcErrorMessage(
  error: any,
  entityMessages?: Record<string, string>
): string {
  const code: string | undefined =
    error.data?.code ??
    (error.status != null
      ? HTTP_STATUS_TO_CODE[error.status as number]
      : undefined);

  if (!code) return error.message ?? "Errore durante l'operazione. Riprova.";

  if (entityMessages?.[code]) return entityMessages[code];
  if (code === 'BAD_REQUEST') return error.message ?? 'Dati non validi';
  if (DEFAULT_MESSAGES[code]) return DEFAULT_MESSAGES[code];

  return error.message ?? "Errore durante l'operazione. Riprova.";
}
