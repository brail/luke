/**
 * Sistema di autenticazione per Luke API
 * Gestisce JWT tokens e sessioni utente per Fastify + tRPC
 * JWT secret derivato dalla master key via HKDF-SHA256
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@luke/core';
import type { PrismaClient } from '@prisma/client';
import { signJWT, verifyJWT, type JWTPayload } from './jwt';

/**
 * Interfaccia per il payload JWT (re-export da jwt.ts)
 */
export type { JWTPayload } from './jwt';

/**
 * Interfaccia per la sessione utente
 */
export interface UserSession {
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    tokenVersion?: number;
  };
}

/**
 * Configurazione JWT (migrata a jwt.ts)
 */
const JWT_EXPIRES_IN = '8h'; // Allineato a NextAuth maxAge

/**
 * Crea un JWT token per un utente
 */
export function createToken(user: {
  id: string;
  email: string;
  username: string;
  role: string;
  tokenVersion?: number;
}): string {
  return signJWT(
    {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    {
      expiresIn: JWT_EXPIRES_IN,
    }
  );
}

/**
 * Verifica e decodifica un JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  return verifyJWT(token);
}

/**
 * Estrae il token JWT dalla richiesta
 * Supporta solo Authorization header (cookie API rimosso)
 */
export function extractTokenFromRequest(
  request: FastifyRequest
): string | null {
  // Solo Authorization header (cookie API rimosso)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * Crea una sessione utente dal token JWT
 */
export function createUserSession(token: string): UserSession | null {
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
      tokenVersion: payload.tokenVersion,
    },
  };
}

/**
 * Middleware per verificare l'autenticazione
 * Estrae il token e verifica la sessione
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<UserSession | null> {
  const token = extractTokenFromRequest(request);

  if (!token) {
    return null;
  }

  const session = createUserSession(token);
  if (!session) {
    // Token non valido, rimuovi il cookie se presente
    (reply as any).clearCookie('luke_session');
    return null;
  }

  return session;
}

/**
 * @deprecated Cookie API rimosso: Web usa solo Authorization header
 * Imposta il cookie di sessione
 */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  // DEPRECATED: Cookie API non più utilizzato
  // (reply as any).cookie('luke_session', token, {
  //   httpOnly: true,
  //   secure: process.env.NODE_ENV === 'production',
  //   sameSite: 'strict',
  //   maxAge: 7 * 24 * 60 * 60 * 1000, // 7 giorni
  //   path: '/',
  // });
}

/**
 * @deprecated Cookie API rimosso: Web usa solo Authorization header
 * Rimuove il cookie di sessione
 */
export function clearSessionCookie(reply: FastifyReply): void {
  // DEPRECATED: Cookie API non più utilizzato
  // (reply as any).clearCookie('luke_session', {
  //   path: '/',
  // });
}
