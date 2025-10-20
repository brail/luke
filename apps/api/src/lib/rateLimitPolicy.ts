/**
 * Rate Limit Policy Resolver
 * Implementa la cascata di risoluzione: AppConfig → ENV → Default
 */

import { RateLimitConfigSchema, type RateLimitPolicy } from '@luke/core';

import { getConfig } from './configManager';

import type { PrismaClient } from '@prisma/client';

/**
 * Default sicuri per backwards compatibility
 * Manteniamo gli stessi valori attuali come fallback
 */
const DEFAULTS: Record<string, RateLimitPolicy> = {
  login: { max: 5, timeWindow: '1m', keyBy: 'ip' },
  passwordChange: { max: 3, timeWindow: '15m', keyBy: 'userId' },
  passwordReset: { max: 3, timeWindow: '15m', keyBy: 'ip' },
  configMutations: { max: 20, timeWindow: '1m', keyBy: 'userId' },
  userMutations: { max: 10, timeWindow: '1m', keyBy: 'userId' },
};

/**
 * Parser per timeWindow: '1m' → 60000ms, '15m' → 900000ms
 * Supporta formati: '30s', '1m', '2h'
 */
function parseTimeWindow(window: string): number {
  const match = window.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error(
      `Invalid timeWindow format: ${window}. Expected format: 30s, 1m, 2h`
    );
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  if (isNaN(num) || num <= 0) {
    throw new Error(
      `Invalid timeWindow value: ${value}. Must be a positive number`
    );
  }

  switch (unit) {
    case 's':
      return num * 1000;
    case 'm':
      return num * 60 * 1000;
    case 'h':
      return num * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}. Supported: s, m, h`);
  }
}

/**
 * Risolve la policy di rate limiting per una rotta specifica
 * Implementa la cascata: AppConfig → ENV → Default
 *
 * @param routeName - Nome della rotta (deve essere in DEFAULTS)
 * @param prisma - Client Prisma per accedere ad AppConfig
 * @returns Configurazione rate limit con max, windowMs, keyBy
 */
export async function resolveRateLimitPolicy(
  routeName: keyof typeof DEFAULTS,
  prisma: PrismaClient
): Promise<{ max: number; windowMs: number; keyBy: 'ip' | 'userId' }> {
  // 1) Tentativo AppConfig (chiave singola 'rateLimit' con JSON object)
  try {
    const configValue = await getConfig(prisma, 'rateLimit', false);
    if (configValue) {
      const parsed = JSON.parse(configValue);
      const validated = RateLimitConfigSchema.safeParse(parsed);

      if (
        validated.success &&
        validated.data[routeName as keyof typeof validated.data]
      ) {
        const policy =
          validated.data[routeName as keyof typeof validated.data]!;
        return {
          max: policy.max,
          windowMs: parseTimeWindow(policy.timeWindow),
          keyBy: policy.keyBy,
        };
      }
    }
  } catch (error) {
    // Log errore ma continua con fallback
    console.warn(`Failed to parse AppConfig rateLimit:`, error);
  }

  // 2) Fallback ENV (es. LUKE_RATE_LIMIT_LOGIN_MAX, LUKE_RATE_LIMIT_LOGIN_WINDOW, LUKE_RATE_LIMIT_LOGIN_KEY_BY)
  const envKey = routeName.toUpperCase();
  const maxEnv = process.env[`LUKE_RATE_LIMIT_${envKey}_MAX`];
  const windowEnv = process.env[`LUKE_RATE_LIMIT_${envKey}_WINDOW`];
  const keyByEnv = process.env[`LUKE_RATE_LIMIT_${envKey}_KEY_BY`];

  if (maxEnv || windowEnv || keyByEnv) {
    const def = DEFAULTS[routeName];
    try {
      return {
        max: maxEnv ? parseInt(maxEnv, 10) : def.max,
        windowMs: windowEnv
          ? parseTimeWindow(windowEnv)
          : parseTimeWindow(def.timeWindow),
        keyBy: (keyByEnv as 'ip' | 'userId') || def.keyBy,
      };
    } catch (error) {
      console.warn(`Invalid ENV rate limit config for ${routeName}:`, error);
      // Fallback ai default se ENV è malformato
    }
  }

  // 3) Default sicuri
  const def = DEFAULTS[routeName];
  return {
    max: def.max,
    windowMs: parseTimeWindow(def.timeWindow),
    keyBy: def.keyBy,
  };
}
