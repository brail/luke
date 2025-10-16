/**
 * Service layer per AuditLog
 * Gestisce logging centralizzato con delta changes e traceId
 */
/**
 * Calcola i cambiamenti tra due oggetti
 * Ritorna solo i campi effettivamente modificati
 */
function calculateChanges(before, after) {
    const changes = {};
    // Controlla tutti i campi di 'after'
    for (const [key, newValue] of Object.entries(after)) {
        const oldValue = before[key];
        // Se il valore è cambiato (confronto shallow)
        if (oldValue !== newValue) {
            changes[key] = { old: oldValue, new: newValue };
        }
    }
    // Controlla campi rimossi (presenti in 'before' ma non in 'after')
    for (const [key, oldValue] of Object.entries(before)) {
        if (!(key in after)) {
            changes[key] = { old: oldValue, new: undefined };
        }
    }
    return changes;
}
/**
 * Filtra password e altri campi sensibili dai metadati
 */
function sanitizeMetadata(metadata) {
    const sanitized = { ...metadata };
    // Rimuovi campi sensibili
    delete sanitized.password;
    delete sanitized.passwordHash;
    delete sanitized.confirmPassword;
    // Se ci sono changes, sanitizza anche quelli
    if (sanitized.changes) {
        const sanitizedChanges = { ...sanitized.changes };
        delete sanitizedChanges.password;
        delete sanitizedChanges.passwordHash;
        delete sanitizedChanges.confirmPassword;
        sanitized.changes = sanitizedChanges;
    }
    return sanitized;
}
/**
 * Logga un evento di audit nel database
 * @param ctx - Context tRPC con traceId
 * @param params - Parametri dell'audit
 */
export async function logAudit(ctx, params) {
    try {
        // Sanitizza i metadati per rimuovere campi sensibili
        const sanitizedMetadata = params.metadata
            ? sanitizeMetadata(params.metadata)
            : {};
        // Aggiungi changes ai metadati se presenti
        const finalMetadata = {
            ...sanitizedMetadata,
            ...(params.changes && { changes: params.changes }),
        };
        // Crea record AuditLog
        await ctx.prisma.auditLog.create({
            data: {
                userId: ctx.session?.user?.id || null,
                targetUserId: params.targetUserId || null,
                action: params.action,
                resource: params.resource,
                metadata: Object.keys(finalMetadata).length > 0 ? finalMetadata : undefined,
                traceId: ctx.traceId,
                ipAddress: ctx.req.ip || null,
            },
        });
        // Log con Pino per correlazione
        ctx.req.log.info({
            traceId: ctx.traceId,
            action: params.action,
            resource: params.resource,
            targetUserId: params.targetUserId,
            userId: ctx.session?.user?.id,
            message: `Audit: ${params.action} on ${params.resource}`,
        });
    }
    catch (error) {
        // Log errore ma non bloccare l'operazione principale
        ctx.req.log.error({
            traceId: ctx.traceId,
            error: error instanceof Error ? error.message : 'Unknown error',
            action: params.action,
            resource: params.resource,
            message: 'Failed to log audit event',
        });
    }
}
/**
 * Helper per loggare creazione utente
 */
export async function logUserCreate(ctx, userId, userData) {
    await logAudit(ctx, {
        action: 'user.create',
        resource: 'user',
        targetUserId: userId,
        metadata: sanitizeMetadata(userData),
    });
}
/**
 * Helper per loggare aggiornamento utente
 */
export async function logUserUpdate(ctx, userId, before, after) {
    const changes = calculateChanges(before, after);
    await logAudit(ctx, {
        action: 'user.update',
        resource: 'user',
        targetUserId: userId,
        changes: Object.keys(changes).length > 0 ? changes : undefined,
    });
}
/**
 * Helper per loggare disattivazione utente
 */
export async function logUserDisable(ctx, userId) {
    await logAudit(ctx, {
        action: 'user.disable',
        resource: 'user',
        targetUserId: userId,
    });
}
/**
 * Helper per loggare eliminazione definitiva utente
 */
export async function logUserHardDelete(ctx, userId) {
    await logAudit(ctx, {
        action: 'user.hardDelete',
        resource: 'user',
        targetUserId: userId,
    });
}
//# sourceMappingURL=auditLog.js.map