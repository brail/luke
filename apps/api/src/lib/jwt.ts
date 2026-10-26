/**
 * JWT utility layer for Luke API.
 * Centralises jsonwebtoken usage with an explicit HS256+HKDF-derived secret strategy.
 * Enforces standard claims (iss, aud, exp, nbf) and a 30-second clock tolerance.
 */

import jwt from 'jsonwebtoken';

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
 * Verifies and decodes a JWT token
 *
 * @param token - JWT token to verify
 * @returns Decoded payload or null if invalid
 */
export function verifyJWT(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, getJWTSecret(), {
      algorithms: [JWT_CONFIG.algorithm],
      clockTolerance: JWT_CONFIG.clockTolerance,
      issuer: JWT_CONFIG.issuer,
      audience: JWT_CONFIG.audience,
    }) as JWTPayload;

    return decoded;
  } catch (error) {
    // A refused token (`JsonWebTokenError`, the parent of the expired and not-before errors) is an
    // expected answer, logged by its message; anything else, such as a secret that cannot be
    // derived, whole. Metadata only, never the full token.
    const refused = error instanceof jwt.JsonWebTokenError;
    logger.error(
      {
        error: refused ? error.message : undefined,
        err: refused ? undefined : error,
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 10) + '...', // Reduced from 20 to 10 chars for security
      },
      'JWT verification failed'
    );
    return null;
  }
}
