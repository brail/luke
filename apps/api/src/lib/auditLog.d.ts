/**
 * Service layer per AuditLog
 * Gestisce logging centralizzato con delta changes e traceId
 */
import type { Context } from './trpc';
/**
 * Parametri per logging audit
 */
export interface AuditParams {
    /** Azione eseguita (es: 'user.create', 'user.update') */
    action: string;
    /** Tipo di risorsa (es: 'user', 'config') */
    resource: string;
    /** ID dell'utente target dell'operazione (opzionale) */
    targetUserId?: string;
    /** Cambiamenti effettuati (solo campi modificati) */
    changes?: Record<string, {
        old: any;
        new: any;
    }>;
    /** Metadati aggiuntivi */
    metadata?: Record<string, any>;
}
/**
 * Logga un evento di audit nel database
 * @param ctx - Context tRPC con traceId
 * @param params - Parametri dell'audit
 */
export declare function logAudit(ctx: Context, params: AuditParams): Promise<void>;
/**
 * Helper per loggare creazione utente
 */
export declare function logUserCreate(ctx: Context, userId: string, userData: Record<string, any>): Promise<void>;
/**
 * Helper per loggare aggiornamento utente
 */
export declare function logUserUpdate(ctx: Context, userId: string, before: Record<string, any>, after: Record<string, any>): Promise<void>;
/**
 * Helper per loggare disattivazione utente
 */
export declare function logUserDisable(ctx: Context, userId: string): Promise<void>;
/**
 * Helper per loggare eliminazione definitiva utente
 */
export declare function logUserHardDelete(ctx: Context, userId: string): Promise<void>;
//# sourceMappingURL=auditLog.d.ts.map