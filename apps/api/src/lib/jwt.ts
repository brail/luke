/**
 * JWT Helper per Luke API
 * Wrapper centralizzato per jsonwebtoken con strategia HS256+HKDF consolidata
 *
 * Caratteristiche:
 * - Algoritmo esplicito: HS256
 * - Clock tolerance: ±60s
 * - Claim standard: iss, aud, exp, nbf
 * - Secret derivato via HKDF dalla master key
 */

import jwt from 'jsonwebtoken';
import pino from 'pino';

import { getApiJwtSecret } from '@luke/core/server';

// Logger interno per JWT
const logger = pino({ level: 'info' });

/**
 * Interfaccia per il payload JWT standardizzato
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
 * Opzioni per la firma JWT
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

/**
 * Ottiene il JWT secret derivato dalla master key
 */
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
 * Verifica se un token è valido senza decodificarlo
 *
 * @param token - JWT token da verificare
 * @returns true se valido, false altrimenti
 */
export function isValidJWT(token: string): boolean {
  return verifyJWT(token) !== null;
}

/**
 * Estrae i metadati di un token senza verificarlo completamente
 * Utile per logging sicuro
 *
 * @param token - JWT token
 * @returns Metadati estratti o null se malformato
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
 * Configurazione JWT esportata per test e debugging
 */
export const JWT_CONFIG_EXPORT = {
  ...JWT_CONFIG,
  // Non esportare mai il secret
} as const;
