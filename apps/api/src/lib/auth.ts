/**
 * Authentication layer for Luke API.
 * Manages JWT tokens and user sessions for Fastify + tRPC.
 * JWT secret is derived from the master key via HKDF-SHA256.
 */

import { hasPermission, type Permission, type Role } from '@luke/core';

import { signJWT, verifyJWT, type JWTPayload } from './jwt';
import { verifyTokenVersion } from './tokenVersionCache';

import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';

export type { JWTPayload } from './jwt';

/**
 * Authenticated user session attached to every tRPC context.
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

const JWT_EXPIRES_IN = '8h'; // aligned to NextAuth maxAge

/**
 * Creates a signed JWT token for the given user payload.
 *
 * @returns Signed JWT string valid for 8 hours.
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
      tokenVersion: user.tokenVersion ?? 0, // Default a 0 se undefined
    },
    {
      expiresIn: JWT_EXPIRES_IN,
    }
  );
}

/**
 * Verifies and decodes a JWT token.
 *
 * @returns Decoded payload, or `null` if the token is invalid or expired.
 */
export function verifyToken(token: string): JWTPayload | null {
  return verifyJWT(token);
}

/**
 * Extracts the JWT token from the request Authorization header.
 * Only Bearer tokens are accepted; cookie-based auth has been removed.
 *
 * @returns Token string, or `null` if the header is absent or malformed.
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
 * Builds a `UserSession` from a raw JWT token.
 *
 * @returns Session object, or `null` if the token is invalid.
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
 * Chiave per il rate limiter: l'id utente se il bearer è valido, altrimenti l'IP.
 *
 * **Non è un controllo di autenticazione.** È solo la chiave del bucket: un token
 * scaduto, assente o manomesso ricade sull'IP, e a rifiutare la richiesta ci
 * pensa l'handler. Verificare la firma qui costa un HMAC e nessuna query.
 *
 * Serve perché le quattro rotte di upload avevano un `keyGenerator` che leggeva
 * `req.session?.user?.id` — che **nessuno assegna mai**: il limiter è un hook
 * `onRequest`, l'auth avviene dentro l'handler. Il ramo sinistro era morto in
 * tutte e quattro, quindi il limite era per IP: un ufficio dietro NAT condivideva
 * 30 upload al minuto fra tutti, e chi ruota indirizzi li moltiplicava.
 */
export function rateLimitKeyFromRequest(request: FastifyRequest): string {
  const token = extractTokenFromRequest(request);
  if (!token) return request.ip;

  return verifyToken(token)?.userId ?? request.ip;
}

/**
 * Fastify hook that authenticates an incoming request.
 * Extracts the Bearer token, verifies the signature **and the revocation state**,
 * and returns the session. Clears the legacy session cookie if the token is invalid.
 *
 * La verifica di revoca sta qui e non un livello più su di proposito: prima
 * viveva solo nel middleware tRPC, quindi ogni route Fastify non-tRPC accettava
 * token revocati e utenti disattivati. Costruire una sessione senza passare da
 * questo controllo ora non è più possibile — è una proprietà della funzione, non
 * una cosa da ricordarsi a ogni nuova route.
 *
 * @returns Authenticated session, or `null` if the request is unauthenticated,
 *   the token is revoked, or the account is disabled.
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  prisma: PrismaClient
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

  const stillValid = await verifyTokenVersion(
    session.user.id,
    session.user.tokenVersion,
    prisma
  );
  if (!stillValid) {
    return null;
  }

  return session;
}

/**
 * Authenticates a raw (non-tRPC) Fastify route and checks a permission, sending the
 * appropriate 401/403 response itself on failure. For routes like file streaming/download
 * that can't go through tRPC's request/response cycle.
 *
 * @returns The session if authenticated and permitted, or `null` after already sending
 *   the error response — callers should `return` immediately when this is `null`.
 */
export async function requireSessionWithPermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
  prisma: PrismaClient
): Promise<UserSession | null> {
  const session = await authenticateRequest(request, reply, prisma);
  if (!session) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  if (!hasPermission({ role: session.user.role as Role }, permission)) {
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }
  return session;
}
