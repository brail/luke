/**
 * Authentication layer for Luke API.
 * Manages JWT tokens and user sessions for Fastify + tRPC.
 * JWT secret is derived from the master key via HKDF-SHA256.
 */

import { hasPermission, type Permission, type Role } from '@luke/core';

import { signJWT, verifyJWT, type JWTPayload } from './jwt';

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
 * Fastify hook that authenticates an incoming request.
 * Extracts the Bearer token, verifies it, and returns the session.
 * Clears the legacy session cookie if the token is invalid.
 *
 * @returns Authenticated session, or `null` if the request is unauthenticated.
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
  permission: Permission
): Promise<UserSession | null> {
  const session = await authenticateRequest(request, reply);
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
