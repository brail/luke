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

interface TrpcErrorLike {
  message?: string;
  data?: { code?: string };
  status?: number;
}

/**
 * Mappa un errore tRPC/HTTP a un messaggio user-friendly in italiano
 *
 * @param error - Errore tRPC o HTTP (accetta unknown, cast interno)
 * @param entityMessages - Override per codici specifici dell'entità (es. CONFLICT, NOT_FOUND)
 * @returns Messaggio localizzato
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
