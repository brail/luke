/**
 * Authentication layer for Luke API.
 * Manages JWT tokens and user sessions for Fastify + tRPC.
 * JWT secret is derived from the master key via HKDF-SHA256.
 */

import { SESSION_ABSOLUTE_LIFETIME_SECONDS, hasPermission, type Permission, type Role } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getTraceId } from './error';
import { JWT_CLOCK_TOLERANCE_SECONDS, signJWT, verifyJWT, type JWTPayload } from './jwt';
import { logAccessDenied } from './permissions';
import { verifyTokenVersion } from './tokenVersionCache';

import type { FastifyRequest, FastifyReply } from 'fastify';
// Side-effect import: brings in @fastify/cookie's `declare module 'fastify'`
// augmentation (reply.clearCookie) into any TS program that reaches this file,
// even ones that don't also reach server.ts (e.g. apps/web's typecheck graph).
import type {} from '@fastify/cookie';

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
    /** Unix seconds of the login the session descends from (`createToken`). */
    authTime?: number;
  };
}

const JWT_EXPIRES_IN_SECONDS = 8 * 60 * 60; // aligned to NextAuth maxAge

/**
 * Creates a signed JWT token for the given user payload.
 *
 * @param authTime - Unix seconds of the login the token descends from: now for a login, the
 *   bearer's own for a refresh. Required, so that no caller starts a fresh 12 h by accident.
 * @returns Signed JWT string valid for 8 hours, and never past `SESSION_ABSOLUTE_LIFETIME_SECONDS`
 *   from `authTime`.
 */
export function createToken(
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    tokenVersion?: number;
  },
  authTime: number
): string {
  const now = Math.floor(Date.now() / 1000);
  return signJWT(
    {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0, // Default to 0 if undefined
      authTime,
    },
    {
      expiresIn: Math.min(JWT_EXPIRES_IN_SECONDS, authTime + SESSION_ABSOLUTE_LIFETIME_SECONDS - now),
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
  // Authorization header only (the cookie API was removed)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return null;
}

/**
 * `true` while a session that logged in at `authTime` may be used: a finite time, ahead of the clock
 * by no more than the JWT tolerance, and less than `SESSION_ABSOLUTE_LIFETIME_SECONDS` ago. Checked
 * where a bearer becomes a session, and on every heartbeat of an SSE stream (`isSseSessionLive`).
 */
export function isWithinSessionLifetime(authTime: number | undefined): authTime is number {
  const now = Math.floor(Date.now() / 1000);
  return (
    // A claim is whatever JSON decoded: `null` for a NaN, `Infinity` for an overflowing number.
    typeof authTime === 'number' &&
    Number.isFinite(authTime) &&
    authTime <= now + JWT_CLOCK_TOLERANCE_SECONDS &&
    now < authTime + SESSION_ABSOLUTE_LIFETIME_SECONDS
  );
}

/**
 * Builds a `UserSession` from a raw JWT token. The one place a bearer becomes a session
 * (`authenticateRequest`), so the absolute lifetime is enforced here, whatever `exp` says.
 *
 * @returns Session object, or `null` if the token is invalid, carries no valid `authTime`, or is
 *   past `SESSION_ABSOLUTE_LIFETIME_SECONDS` from it.
 */
export function createUserSession(token: string): UserSession | null {
  const payload = verifyToken(token);
  if (!payload || !isWithinSessionLifetime(payload.authTime)) {
    return null;
  }

  return {
    user: {
      id: payload.userId,
      email: payload.email,
      username: payload.username,
      role: payload.role,
      tokenVersion: payload.tokenVersion,
      authTime: payload.authTime,
    },
  };
}

/**
 * Rate limiter key: the user id if the bearer token is valid, otherwise the IP.
 *
 * **Not an authentication check.** It's only the bucket key: an expired,
 * missing, or tampered token falls back to the IP, and rejecting the request
 * is the handler's job. Verifying the signature here costs one HMAC and no query.
 *
 * Needed because the four upload routes had a `keyGenerator` that read
 * `req.session?.user?.id` — which **nobody ever assigns**: the limiter is an
 * `onRequest` hook, auth happens inside the handler. That branch was dead in
 * all four, so the limit ended up being per-IP: an office behind NAT shared
 * 30 uploads a minute among everyone, and anyone rotating addresses multiplied it.
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
 * The revocation check lives here and not one layer up on purpose: it used to
 * live only in the tRPC middleware, so every non-tRPC Fastify route accepted
 * revoked tokens and disabled users. Building a session without going through
 * this check is no longer possible now — it's a property of the function, not
 * something to remember for every new route.
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
    // Invalid token, remove the cookie if present
    reply.clearCookie('luke_session');
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
    logAccessDenied(
      { logger: request.log, traceId: getTraceId(request), session },
      { deniedPermissions: [permission] }
    );
    reply.code(403).send({ error: 'Forbidden' });
    return null;
  }
  return session;
}
