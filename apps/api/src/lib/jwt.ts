/**
 * JWT utility layer for Luke API.
 * Centralises jsonwebtoken usage with an explicit HS256+HKDF-derived secret strategy.
 * Enforces standard claims (iss, aud, exp, nbf) and a 30-second clock tolerance.
 */

import jwt from 'jsonwebtoken';
import pino from 'pino';

import { getApiJwtSecret } from '@luke/core/server';

// Internal logger for JWT
const logger = pino({ level: 'info' });

/**
 * Standardised JWT payload shape used across the API.
 */
export interface JWTPayload {
  userId: string;
  email: string;
  username: string;
  role: string;
  tokenVersion?: number;
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

/**
 * Standardised JWT configuration
 */
const JWT_CONFIG = {
  algorithm: 'HS256' as const,
  clockTolerance: 5, // ±5 seconds — sufficient for NTP skew, reduces replay window
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
    'userId' | 'email' | 'username' | 'role' | 'tokenVersion'
  >,
  options: JWTSignOptions = {}
): string {
  const jwtPayload: Omit<JWTPayload, 'iat' | 'exp' | 'nbf'> = {
    userId: payload.userId,
    email: payload.email,
    username: payload.username,
    role: payload.role,
    tokenVersion: payload.tokenVersion,
    iss: JWT_CONFIG.issuer,
    aud: JWT_CONFIG.audience,
  };

  const signOptions: jwt.SignOptions = {
    algorithm: JWT_CONFIG.algorithm,
    expiresIn: options.expiresIn || JWT_CONFIG.defaultExpiresIn,
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
    // Log metadata only, never the full token
    logger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 10) + '...', // Reduced from 20 to 10 chars for security
      },
      'JWT verification failed'
    );
    return null;
  }
}
