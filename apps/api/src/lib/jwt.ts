/**
 * JWT utility layer for Luke API.
 * Centralises jsonwebtoken usage with an explicit HS256+HKDF-derived secret strategy.
 * Enforces standard claims (iss, aud, exp, nbf) and a 30-second clock tolerance.
 */

import jwt from 'jsonwebtoken';
import pino from 'pino';

import { getApiJwtSecret } from '@luke/core/server';

// Logger interno per JWT
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
 * Configurazione JWT standardizzata
 */
const JWT_CONFIG = {
  algorithm: 'HS256' as const,
  clockTolerance: 30, // ±30 secondi (ridotto da 60s)
  issuer: 'urn:luke',
  audience: 'luke.api',
  defaultExpiresIn: '7d',
} as const;

function getJWTSecret(): string {
  return getApiJwtSecret();
}

/**
 * Crea un JWT token con configurazione standardizzata
 *
 * @param payload - Payload base (userId, email, username, role)
 * @param options - Opzioni aggiuntive per expiresIn e notBefore
 * @returns JWT token firmato
 */
export function signJWT(
  payload: Pick<
    JWTPayload,
    'userId' | 'email' | 'username' | 'role' | 'tokenVersion'
  >,
  options: JWTSignOptions = {}
): string {
  // const now = Math.floor(Date.now() / 1000);

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
 * Verifica e decodifica un JWT token
 *
 * @param token - JWT token da verificare
 * @returns Payload decodificato o null se invalido
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
    // Log solo metadata, mai il token completo
    logger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 10) + '...', // Ridotto da 20 a 10 char per sicurezza
      },
      'JWT verification failed'
    );
    return null;
  }
}

/**
 * Returns `true` if the token passes full JWT verification, `false` otherwise.
 */
export function isValidJWT(token: string): boolean {
  return verifyJWT(token) !== null;
}

/**
 * Decodes a JWT token without verifying the signature.
 * Safe to use for structured logging — never trust the result for authorisation.
 *
 * @returns Extracted metadata fields, or `null` if the token is malformed.
 */
export function extractJWTMetadata(token: string): {
  userId?: string;
  role?: string;
  exp?: number;
  iat?: number;
} | null {
  try {
    // Decodifica senza verifica (header + payload)
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || typeof decoded === 'string') {
      return null;
    }

    const payload = decoded.payload as any;

    return {
      userId: payload.userId,
      role: payload.role,
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Read-only JWT configuration snapshot for tests and debugging.
 * The secret is never included.
 */
export const JWT_CONFIG_EXPORT = {
  ...JWT_CONFIG,
  // Non esportare mai il secret
} as const;
