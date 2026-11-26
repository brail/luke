/**
 * JWT utility layer for Luke API.
 * Centralises jsonwebtoken usage with an explicit HS256+HKDF-derived secret strategy.
 * Enforces standard claims (iss, aud, exp, nbf) and a 30-second clock tolerance.
 */

import jwt from 'jsonwebtoken';

import { toErrorMessage } from '@luke/core';
import { getApiJwtSecret } from '@luke/core/server';

import { rootLogger } from './logger';

const logger = rootLogger.child({ module: 'jwt' });

/**
 * Standardised JWT payload shape used across the API.
 */
export interface JWTPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
  tokenVersion?: number;
  /** Unix seconds of the login the token descends from; absent from a token signed before it existed. */
  authTime?: number;
  iat: number;
  exp: number;
  nbf: number;
  iss: string;
  aud: string;
}

/**
 * Optional overrides for JWT signing (expiry and not-before).
 */
export interface JWTSignOptions {
  expiresIn?: string | number;
  notBefore?: string | number;
}

/** Clock skew tolerated on `exp` and `nbf`, and on `authTime` by `createUserSession`. */
export const JWT_CLOCK_TOLERANCE_SECONDS = 5; // sufficient for NTP skew, reduces replay window

/**
 * Standardised JWT configuration
 */
const JWT_CONFIG = {
  algorithm: 'HS256' as const,
  clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
  issuer: 'urn:luke',
  audience: 'luke.api',
  defaultExpiresIn: '7d',
} as const;

function getJWTSecret(): string {
  return getApiJwtSecret();
}

/**
 * Creates a JWT token with standardised configuration
 *
 * @param payload - Base payload (userId, email, username, role)
 * @param options - Additional options for expiresIn and notBefore
 * @returns Signed JWT token
 */
export function signJWT(
  payload: Pick<
    JWTPayload,
    'userId' | 'email' | 'username' | 'role' | 'tokenVersion' | 'authTime'
  >,
  options: JWTSignOptions = {}
): string {
  const jwtPayload: Omit<JWTPayload, 'iat' | 'exp' | 'nbf'> = {
    userId: payload.userId,
    email: payload.email,
    username: payload.username,
    role: payload.role,
    tokenVersion: payload.tokenVersion,
    authTime: payload.authTime,
    iss: JWT_CONFIG.issuer,
    aud: JWT_CONFIG.audience,
  };

  const signOptions: jwt.SignOptions = {
    algorithm: JWT_CONFIG.algorithm,
    // `??`, not `||`: an `expiresIn` of 0 (a session at its 12 h limit) must not become 7 days.
    expiresIn: options.expiresIn ?? JWT_CONFIG.defaultExpiresIn,
    notBefore: options.notBefore || 0,
  } as jwt.SignOptions;

  return jwt.sign(jwtPayload, getJWTSecret(), signOptions);
}

/**
 * Verifies and decodes a JWT token.
 *
 * @param token - JWT token to verify
 * @returns Decoded payload, or `null` when the token is refused: whatever `jwt.verify` throws comes
 *   from the token (bad signature, malformed, unparsable, expired, not yet valid, wrong issuer or
 *   audience)
 * @throws When the secret cannot be derived: a server fault fails the request, logged by its error
 *   handler, and never reads as an ended session (ADR-052, #299)
 */
export function verifyJWT(token: string): JWTPayload | null {
  // Outside the `try`: the one failure that is the server's, not the token's.
  const secret = getJWTSecret();
  try {
    return jwt.verify(token, secret, {
      algorithms: [JWT_CONFIG.algorithm],
      clockTolerance: JWT_CONFIG.clockTolerance,
      issuer: JWT_CONFIG.issuer,
      audience: JWT_CONFIG.audience,
      // `verify` types its answer as `string | JwtPayload`; a token that passes was signed by
      // `signJWT` with our secret, so it carries `JWTPayload`'s claims.
    }) as JWTPayload;
  } catch (error) {
    // Metadata only, never the full token. An expired or not-yet-valid token is routine (the web
    // refreshes it); any other refusal, a forged or garbled bearer included, is worth a warning.
    const routine = error instanceof jwt.TokenExpiredError || error instanceof jwt.NotBeforeError;
    logger[routine ? 'debug' : 'warn'](
      {
        error: toErrorMessage(error),
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 10) + '...',
      },
      'JWT refused'
    );
    return null;
  }
}
