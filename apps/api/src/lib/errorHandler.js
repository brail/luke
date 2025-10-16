/**
 * Gestione errori uniforme per Luke API
 * Fornisce un modello standardizzato per errori e logging sicuro
 */
import { TRPCError } from '@trpc/server';
/**
 * Codici di errore standardizzati
 */
export var ErrorCode;
(function (ErrorCode) {
    // Errori di validazione
    ErrorCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorCode["INVALID_INPUT"] = "INVALID_INPUT";
    // Errori di autenticazione
    ErrorCode["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorCode["FORBIDDEN"] = "FORBIDDEN";
    // Errori di configurazione
    ErrorCode["CONFIG_ERROR"] = "CONFIG_ERROR";
    ErrorCode["CONNECTION_ERROR"] = "CONNECTION_ERROR";
    // Errori di database
    ErrorCode["DATABASE_ERROR"] = "DATABASE_ERROR";
    // Errori di integrazione
    ErrorCode["INTEGRATION_ERROR"] = "INTEGRATION_ERROR";
    ErrorCode["SMTP_ERROR"] = "SMTP_ERROR";
    ErrorCode["STORAGE_ERROR"] = "STORAGE_ERROR";
    // Errori generici
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
    ErrorCode["NOT_FOUND"] = "NOT_FOUND";
    ErrorCode["CONFLICT"] = "CONFLICT";
})(ErrorCode || (ErrorCode = {}));
/**
 * Crea un errore standardizzato
 */
export function createStandardError(code, message, details, traceId) {
    return {
        code,
        message,
        details,
        timestamp: new Date().toISOString(),
        traceId,
    };
}
/**
 * Converte un errore standardizzato in TRPCError
 */
export function toTRPCError(error) {
    const httpStatus = getHttpStatusFromErrorCode(error.code);
    return new TRPCError({
        code: getTRPCCodeFromErrorCode(error.code),
        message: error.message,
        cause: error.details,
    });
}
/**
 * Mappa i codici di errore ai codici HTTP
 */
function getHttpStatusFromErrorCode(code) {
    switch (code) {
        case ErrorCode.VALIDATION_ERROR:
        case ErrorCode.INVALID_INPUT:
            return 400;
        case ErrorCode.UNAUTHORIZED:
            return 401;
        case ErrorCode.FORBIDDEN:
            return 403;
        case ErrorCode.NOT_FOUND:
            return 404;
        case ErrorCode.CONFLICT:
            return 409;
        case ErrorCode.CONFIG_ERROR:
        case ErrorCode.CONNECTION_ERROR:
        case ErrorCode.DATABASE_ERROR:
        case ErrorCode.INTEGRATION_ERROR:
        case ErrorCode.SMTP_ERROR:
        case ErrorCode.STORAGE_ERROR:
        case ErrorCode.INTERNAL_ERROR:
        default:
            return 500;
    }
}
/**
 * Mappa i codici di errore ai codici tRPC
 */
function getTRPCCodeFromErrorCode(code) {
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
 * Sanitizza i dati sensibili per il logging
 */
export function sanitizeForLogging(data) {
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
    const sanitized = { ...data };
    for (const key in sanitized) {
        if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive.toLowerCase()))) {
            sanitized[key] = '[REDACTED]';
        }
        else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeForLogging(sanitized[key]);
        }
    }
    return sanitized;
}
/**
 * Logger sicuro che non espone dati sensibili
 */
export class SecureLogger {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    info(message, data) {
        this.logger.info(message, data ? sanitizeForLogging(data) : undefined);
    }
    warn(message, data) {
        this.logger.warn(message, data ? sanitizeForLogging(data) : undefined);
    }
    error(message, error) {
        this.logger.error(message, error ? sanitizeForLogging(error) : undefined);
    }
    debug(message, data) {
        this.logger.debug(message, data ? sanitizeForLogging(data) : undefined);
    }
}
/**
 * Utility per gestire errori di integrazione
 */
export class IntegrationErrorHandler {
    static handleSMTPError(error) {
        return createStandardError(ErrorCode.SMTP_ERROR, 'Errore configurazione SMTP', {
            originalError: error.message,
            type: 'smtp_connection_failed',
        });
    }
    static handleStorageError(provider, error) {
        return createStandardError(ErrorCode.STORAGE_ERROR, `Errore connessione storage ${provider}`, {
            provider,
            originalError: error.message,
            type: 'storage_connection_failed',
        });
    }
    static handleConfigError(key, error) {
        return createStandardError(ErrorCode.CONFIG_ERROR, `Errore salvataggio configurazione ${key}`, {
            configKey: key,
            originalError: error.message,
            type: 'config_save_failed',
        });
    }
}
//# sourceMappingURL=errorHandler.js.map