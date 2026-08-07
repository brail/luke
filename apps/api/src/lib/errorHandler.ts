/**
 * Unified error model and secure logging utilities for Luke API.
 */

import { TRPCError } from '@trpc/server';

import type { FastifyBaseLogger } from 'fastify';

/**
 * Standardised error codes used across the API.
 */
export enum ErrorCode {
  // Errori di validazione
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // Errori di autenticazione
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Errori di configurazione
  CONFIG_ERROR = 'CONFIG_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',

  // Errori di database
  DATABASE_ERROR = 'DATABASE_ERROR',

  // Errori di integrazione
  INTEGRATION_ERROR = 'INTEGRATION_ERROR',
  SMTP_ERROR = 'SMTP_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',

  // Errori generici
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
}

/**
 * Structured error object returned by `createStandardError`.
 */
export interface StandardError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  timestamp: string;
  traceId?: string;
}

/**
 * Creates a `StandardError` with the current timestamp.
 */
export function createStandardError(
  code: ErrorCode,
  message: string,
  details?: unknown,
  traceId?: string
): StandardError {
  return {
    code,
    message,
    details,
    timestamp: new Date().toISOString(),
    traceId,
  };
}

/**
 * Converts a `StandardError` into a `TRPCError` with the appropriate tRPC error code.
 */
export function toTRPCError(error: StandardError): TRPCError {
  // const httpStatus = getHttpStatusFromErrorCode(error.code);

  return new TRPCError({
    code: getTRPCCodeFromErrorCode(error.code),
    message: error.message,
    cause: error.details,
  });
}

/**
 * Mappa i codici di errore ai codici tRPC
 */
function getTRPCCodeFromErrorCode(
  code: ErrorCode
):
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_SERVER_ERROR' {
  switch (code) {
    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.INVALID_INPUT:
      return 'BAD_REQUEST';
    case ErrorCode.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case ErrorCode.FORBIDDEN:
      return 'FORBIDDEN';
    case ErrorCode.NOT_FOUND:
      return 'NOT_FOUND';
    case ErrorCode.CONFLICT:
      return 'CONFLICT';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}

/**
 * Recursively redacts values whose keys match known sensitive patterns
 * (password, token, secret, key, auth, credential, apiKey, etc.).
 *
 * @returns Deep clone of `data` with sensitive values replaced by `'[REDACTED]'`.
 */
export function sanitizeForLogging(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'key',
    'auth',
    'credential',
    'apiKey',
    'accessToken',
    'refreshToken',
    'clientSecret',
  ];

  // Il check `typeof data === 'object'` sopra garantisce un oggetto non-null:
  // sicuro trattarlo come record per la redazione ricorsiva delle chiavi.
  const sanitized: Record<string, unknown> = { ...(data as Record<string, unknown>) };

  for (const key in sanitized) {
    if (
      sensitiveKeys.some(sensitive =>
        key.toLowerCase().includes(sensitive.toLowerCase())
      )
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Logger wrapper that automatically sanitises all data payloads before writing,
 * ensuring sensitive fields are never emitted to the log stream.
 */
export class SecureLogger {
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  // Pino expects (mergingObject, message) — object first — while console accepts args in
  // any order without losing information, so putting the sanitized object first keeps it
  // structured under Pino and stays harmless under console.
  info(message: string, data?: unknown) {
    // sanitizeForLogging ritorna unknown perché accetta qualunque input; qui il
    // chiamante passa sempre un oggetto strutturato, coerente con l'overload Pino.
    data ? this.logger.info(sanitizeForLogging(data) as object, message) : this.logger.info(message);
  }

  warn(message: string, data?: unknown) {
    data ? this.logger.warn(sanitizeForLogging(data) as object, message) : this.logger.warn(message); // vedi info()
  }

  error(message: string, error?: unknown) {
    error ? this.logger.error(sanitizeForLogging(error) as object, message) : this.logger.error(message); // vedi info()
  }

  debug(message: string, data?: unknown) {
    data ? this.logger.debug(sanitizeForLogging(data) as object, message) : this.logger.debug(message); // vedi info()
  }
}

/**
 * Factory helpers for common integration error scenarios (SMTP, storage, config).
 */
export class IntegrationErrorHandler {
  static handleSMTPError(error: unknown): StandardError {
    return createStandardError(
      ErrorCode.SMTP_ERROR,
      'Errore configurazione SMTP',
      {
        originalError: error instanceof Error ? error.message : String(error),
        type: 'smtp_connection_failed',
      }
    );
  }

  static handleStorageError(provider: string, error: unknown): StandardError {
    return createStandardError(
      ErrorCode.STORAGE_ERROR,
      `Errore connessione storage ${provider}`,
      {
        provider,
        originalError: error instanceof Error ? error.message : String(error),
        type: 'storage_connection_failed',
      }
    );
  }

  static handleConfigError(key: string, error: unknown): StandardError {
    return createStandardError(
      ErrorCode.CONFIG_ERROR,
      `Errore salvataggio configurazione ${key}`,
      {
        configKey: key,
        originalError: error instanceof Error ? error.message : String(error),
        type: 'config_save_failed',
      }
    );
  }
}
