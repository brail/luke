/**
 * Unified error model for Luke API.
 */

import { TRPCError } from '@trpc/server';

import { toErrorMessage } from './error';

/**
 * Standardised error codes used across the API.
 */
export enum ErrorCode {
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // Authentication errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',

  // Configuration errors
  CONFIG_ERROR = 'CONFIG_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',

  // Database errors
  DATABASE_ERROR = 'DATABASE_ERROR',

  // Integration errors
  INTEGRATION_ERROR = 'INTEGRATION_ERROR',
  SMTP_ERROR = 'SMTP_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',

  // Generic errors
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
  return new TRPCError({
    code: getTRPCCodeFromErrorCode(error.code),
    message: error.message,
    cause: error.details,
  });
}

/**
 * Maps error codes to tRPC codes
 */
function getTRPCCodeFromErrorCode(
  code: ErrorCode
):
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
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
    // Incomplete configuration is the caller's to fix, so its text must reach them: a 5xx is
    // masked in production.
    case ErrorCode.CONFIG_ERROR:
      return 'PRECONDITION_FAILED';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}

/**
 * Factory helpers for integration error scenarios (currently SMTP).
 */
export class IntegrationErrorHandler {
  static handleSMTPError(error: unknown): StandardError {
    return createStandardError(
      ErrorCode.SMTP_ERROR,
      'Errore configurazione SMTP',
      {
        originalError: toErrorMessage(error),
        type: 'smtp_connection_failed',
      }
    );
  }
}
