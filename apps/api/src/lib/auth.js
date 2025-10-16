/**
 * Sistema di autenticazione per Luke API
 * Gestisce JWT tokens e sessioni utente per Fastify + tRPC
 * JWT secret derivato dalla master key via HKDF-SHA256
 */
import jwt from 'jsonwebtoken';
import { deriveSecret } from '@luke/core/server';
/**
 * Ottiene il JWT secret derivato dalla master key via HKDF
 */
function getJWTSecret() {
    return deriveSecret('api.jwt');
}
/**
 * Configurazione JWT
 */
const JWT_EXPIRES_IN = '7d';
/**
 * Crea un JWT token per un utente
 */
export function createToken(user) {
    const payload = {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
    };
    return jwt.sign(payload, getJWTSecret(), {
        expiresIn: JWT_EXPIRES_IN,
    });
}
/**
 * Verifica e decodifica un JWT token
 */
export function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, getJWTSecret());
        return decoded;
    }
    catch (error) {
        console.error('Errore verifica token:', error);
        return null;
    }
}
/**
 * Estrae il token JWT dalla richiesta
 * Supporta Authorization header e cookie
 */
export function extractTokenFromRequest(request) {
    // Prova prima l'Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    // Prova poi il cookie
    const token = request.cookies?.luke_session;
    if (token) {
        return token;
    }
    return null;
}
/**
 * Crea una sessione utente dal token JWT
 */
export function createUserSession(token) {
    const payload = verifyToken(token);
    if (!payload) {
        return null;
    }
    return {
        user: {
            id: payload.userId,
            email: payload.email,
            username: payload.username,
            role: payload.role,
        },
    };
}
/**
 * Middleware per verificare l'autenticazione
 * Estrae il token e verifica la sessione
 */
export async function authenticateRequest(request, reply) {
    const token = extractTokenFromRequest(request);
    if (!token) {
        return null;
    }
    const session = createUserSession(token);
    if (!session) {
        // Token non valido, rimuovi il cookie se presente
        reply.clearCookie('luke_session');
        return null;
    }
    return session;
}
/**
 * Imposta il cookie di sessione
 */
export function setSessionCookie(reply, token) {
    reply.cookie('luke_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni
        path: '/',
    });
}
/**
 * Rimuove il cookie di sessione
 */
export function clearSessionCookie(reply) {
    reply.clearCookie('luke_session', {
        path: '/',
    });
}
//# sourceMappingURL=auth.js.map