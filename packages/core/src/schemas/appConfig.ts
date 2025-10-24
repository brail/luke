import { z } from 'zod';

/**
 * Schema Zod per il modello AppConfig
 * Definisce la struttura di una configurazione dell'applicazione
 */
export const AppConfigSchema = z.object({
  /** Chiave identificativa della configurazione */
  key: z.string().min(1),

  /** Valore della configurazione (oggetto serializzabile generico) */
  value: z.unknown(),

  /** Versione della configurazione per gestire aggiornamenti */
  version: z.number().int().positive(),

  /** Data di creazione della configurazione */
  createdAt: z.date(),

  /** Data dell'ultimo aggiornamento */
  updatedAt: z.date(),
});

/**
 * Tipo TypeScript inferito dallo schema AppConfig
 */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Schema per una singola policy di rate limiting
 */
export const RateLimitPolicySchema = z.object({
  /** Numero massimo di richieste consentite */
  max: z.number().int().positive(),
  /** Finestra temporale (es. '1m', '15m', '2h') */
  timeWindow: z.string().min(2),
  /** Tipo di chiave per il rate limiting */
  keyBy: z.enum(['ip', 'userId']).default('ip'),
});

/**
 * Schema per la configurazione completa del rate limiting
 */
export const RateLimitConfigSchema = z.object({
  /** Policy per endpoint di login */
  login: RateLimitPolicySchema.optional(),
  /** Policy per cambio password */
  passwordChange: RateLimitPolicySchema.optional(),
  /** Policy per reset password */
  passwordReset: RateLimitPolicySchema.optional(),
  /** Policy per mutazioni di configurazione */
  configMutations: RateLimitPolicySchema.optional(),
  /** Policy per mutazioni di utenti */
  userMutations: RateLimitPolicySchema.optional(),
});

/**
 * Schema per la configurazione di resilienza LDAP
 */
export const LdapResilienceSchema = z.object({
  /** Timeout per operazione LDAP in millisecondi */
  timeoutMs: z.number().int().positive().default(3000),
  /** Numero massimo di retry per operazioni fallite */
  maxRetries: z.number().int().min(0).default(2),
  /** Delay base per exponential backoff in millisecondi */
  baseDelayMs: z.number().int().min(10).default(200),
  /** Soglia di failure per aprire il circuit breaker */
  breakerFailureThreshold: z.number().int().min(1).default(5),
  /** Cooldown del circuit breaker in millisecondi */
  breakerCooldownMs: z.number().int().min(500).default(10000),
  /** Numero massimo di tentativi in stato half-open */
  halfOpenMaxAttempts: z.number().int().min(1).default(1),
});

/**
 * Tipi TypeScript per rate limiting
 */
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

/**
 * Tipo TypeScript per configurazione resilienza LDAP
 */
export type LdapResilienceConfig = z.infer<typeof LdapResilienceSchema>;

/**
 * Schema per i defaults del context (Brand/Season)
 * Utilizzato per configurare i default organizzativi
 */
export const AppContextDefaultsSchema = z.object({
  context: z
    .object({
      brandId: z.string().uuid().optional(),
      seasonId: z.string().uuid().optional(),
    })
    .optional()
    .default({}),
});

/**
 * Tipo TypeScript per defaults del context
 */
export type AppContextDefaults = z.infer<typeof AppContextDefaultsSchema>;
