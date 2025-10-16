/**
 * Gestione errori uniforme per Luke API
 * Fornisce un modello standardizzato per errori e logging sicuro
 */
import { TRPCError } from '@trpc/server';
/**
 * Codici di errore standardizzati
 */
export declare enum ErrorCode {
    VALIDATION_ERROR = "VALIDATION_ERROR",
    INVALID_INPUT = "INVALID_INPUT",
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    CONFIG_ERROR = "CONFIG_ERROR",
    CONNECTION_ERROR = "CONNECTION_ERROR",
    DATABASE_ERROR = "DATABASE_ERROR",
    INTEGRATION_ERROR = "INTEGRATION_ERROR",
    SMTP_ERROR = "SMTP_ERROR",
    STORAGE_ERROR = "STORAGE_ERROR",
    INTERNAL_ERROR = "INTERNAL_ERROR",
    NOT_FOUND = "NOT_FOUND",
    CONFLICT = "CONFLICT"
}
/**
 * Interfaccia per errori standardizzati
 */
export interface StandardError {
    code: ErrorCode;
    message: string;
    details?: any;
    timestamp: string;
    traceId?: string;
}
/**
 * Crea un errore standardizzato
 */
export declare function createStandardError(code: ErrorCode, message: string, details?: any, traceId?: string): StandardError;
/**
 * Converte un errore standardizzato in TRPCError
 */
export declare function toTRPCError(error: StandardError): TRPCError;
/**
 * Sanitizza i dati sensibili per il logging
 */
export declare function sanitizeForLogging(data: any): any;
/**
 * Logger sicuro che non espone dati sensibili
 */
export declare class SecureLogger {
    private logger;
    constructor(logger: any);
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, error?: any): void;
    debug(message: string, data?: any): void;
}
/**
 * Utility per gestire errori di integrazione
 */
export declare class IntegrationErrorHandler {
    static handleSMTPError(error: any): StandardError;
    static handleStorageError(provider: string, error: any): StandardError;
    static handleConfigError(key: string, error: any): StandardError;
}
//# sourceMappingURL=errorHandler.d.ts.map