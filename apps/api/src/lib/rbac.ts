/**
 * RBAC Middleware Guards per tRPC
 * Guardie riusabili per controllo accessi basato su ruoli
 *
 * Elimina la necessità di check manuali sparsi nei router
 * e fornisce middleware compositabili per tRPC
 */

import { TRPCError } from '@trpc/server';

import type { Role } from '@luke/core';

import type { UserSession } from './auth';

/**
 * Middleware function type per tRPC
 */
type MiddlewareFunction = <_TInput, TOutput>(opts: {
  ctx: { session: UserSession | null };
  next: () => Promise<TOutput>;
}) => Promise<TOutput>;

/**
 * Verifica se l'utente ha uno dei ruoli autorizzati
 * Helper interno per le guardie
 *
 * @param session - Sessione utente
 * @param allowedRoles - Array di ruoli autorizzati
 * @throws TRPCError se accesso negato
 */
function ensureRoles(session: UserSession | null, allowedRoles: Role[]): void {
  if (!session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Accesso negato: richiesto uno dei ruoli ${allowedRoles.join(', ')}`,
    });
  }
}

/**
 * Crea un middleware per un singolo ruolo
 *
 * @param role - Ruolo richiesto
 * @returns Middleware function per tRPC
 */
export function withRole(role: Role): MiddlewareFunction {
  return async ({ ctx, next }) => {
    ensureRoles(ctx.session, [role]);
    return next();
  };
}

/**
 * Crea un middleware per uno o più ruoli
 *
 * @param roles - Array di ruoli autorizzati
 * @returns Middleware function per tRPC
 */
export function roleIn(roles: Role[]): MiddlewareFunction {
  return async ({ ctx, next }) => {
    ensureRoles(ctx.session, roles);
    return next();
  };
}

/**
 * Middleware per ruolo admin
 * Alias per withRole('admin')
 */
export const adminOnly: MiddlewareFunction = withRole('admin');

/**
 * Middleware per ruoli admin o editor
 * Alias per roleIn(['admin', 'editor'])
 */
export const adminOrEditor: MiddlewareFunction = roleIn(['admin', 'editor']);

/**
 * Middleware per ruoli admin o editor (alias per adminOrEditor)
 * Utile per operazioni che richiedono privilegi elevati ma non necessariamente admin
 */
export const adminOrManager: MiddlewareFunction = roleIn(['admin', 'editor']);

/**
 * Middleware per tutti i ruoli autenticati
 * Verifica solo che l'utente sia autenticato (qualsiasi ruolo)
 */
export const authenticatedOnly: MiddlewareFunction = async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }
  return next();
};

/**
 * Helper per verificare se un utente può accedere a una risorsa
 * Utile per logica condizionale nei resolver
 *
 * @param session - Sessione utente
 * @param allowedRoles - Ruoli autorizzati
 * @returns true se accesso consentito, false altrimenti
 */
export function canAccess(
  session: UserSession | null,
  allowedRoles: Role[]
): boolean {
  if (!session) return false;
  return allowedRoles.includes(session.user.role as Role);
}

/**
 * Helper per verificare se un utente è admin
 *
 * @param session - Sessione utente
 * @returns true se admin, false altrimenti
 */
export function isAdmin(session: UserSession | null): boolean {
  return canAccess(session, ['admin']);
}

/**
 * Helper per verificare se un utente è admin o editor
 *
 * @param session - Sessione utente
 * @returns true se admin o editor, false altrimenti
 */
export function isAdminOrEditor(session: UserSession | null): boolean {
  return canAccess(session, ['admin', 'editor']);
}

/**
 * Helper per verificare se un utente può modificare un'altro utente
 * Gli admin possono modificare tutti, gli utenti possono modificare solo se stessi
 *
 * @param session - Sessione utente corrente
 * @param targetUserId - ID dell'utente da modificare
 * @returns true se può modificare, false altrimenti
 */
export function canModifyUser(
  session: UserSession | null,
  targetUserId: string
): boolean {
  if (!session) return false;

  // Admin può modificare tutti
  if (isAdmin(session)) return true;

  // Utenti possono modificare solo se stessi
  return session.user.id === targetUserId;
}

/**
 * Helper per verificare se un utente può visualizzare un'altro utente
 * Admin ed editor possono vedere tutti, gli utenti possono vedere solo se stessi
 *
 * @param session - Sessione utente corrente
 * @param targetUserId - ID dell'utente da visualizzare
 * @returns true se può visualizzare, false altrimenti
 */
export function canViewUser(
  session: UserSession | null,
  targetUserId: string
): boolean {
  if (!session) return false;

  // Admin ed editor possono vedere tutti
  if (isAdminOrEditor(session)) return true;

  // Utenti possono vedere solo se stessi
  return session.user.id === targetUserId;
}

/**
 * Configurazione RBAC esportata per test e debugging
 */
export const RBAC_CONFIG = {
  roles: ['admin', 'editor', 'viewer'] as const,
  permissions: {
    admin: ['*'], // Tutti i permessi
    editor: ['read', 'update'], // Lettura e modifica
    viewer: ['read'], // Solo lettura
  },
} as const;
