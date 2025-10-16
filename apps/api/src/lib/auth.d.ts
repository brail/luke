/**
 * Sistema di autenticazione per Luke API
 * Gestisce JWT tokens e sessioni utente per Fastify + tRPC
 * JWT secret derivato dalla master key via HKDF-SHA256
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
/**
 * Interfaccia per il payload JWT
 */
export interface JWTPayload {
    userId: string;
    email: string;
    username: string;
    role: string;
    iat: number;
    exp: number;
}
/**
 * Interfaccia per la sessione utente
 */
export interface UserSession {
    user: {
        id: string;
        email: string;
        username: string;
        role: string;
    };
}
/**
 * Crea un JWT token per un utente
 */
export declare function createToken(user: {
    id: string;
    email: string;
    username: string;
    role: string;
}): string;
/**
 * Verifica e decodifica un JWT token
 */
export declare function verifyToken(token: string): JWTPayload | null;
/**
 * Estrae il token JWT dalla richiesta
 * Supporta Authorization header e cookie
 */
export declare function extractTokenFromRequest(request: FastifyRequest): string | null;
/**
 * Crea una sessione utente dal token JWT
 */
export declare function createUserSession(token: string): UserSession | null;
/**
 * Middleware per verificare l'autenticazione
 * Estrae il token e verifica la sessione
 */
export declare function authenticateRequest(request: FastifyRequest, reply: FastifyReply): Promise<UserSession | null>;
/**
 * Imposta il cookie di sessione
 */
export declare function setSessionCookie(reply: FastifyReply, token: string): void;
/**
 * Rimuove il cookie di sessione
 */
export declare function clearSessionCookie(reply: FastifyReply): void;
//# sourceMappingURL=auth.d.ts.map