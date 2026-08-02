import { z } from 'zod';

/**
 * Shape of a single AppConfig record as persisted in the database (generic KV entry).
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

/** TypeScript type inferred from `AppConfigSchema`. */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Rate limiting policy for a single endpoint category.
 * `keyBy` controls whether the limit is per IP address or per authenticated user.
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
 * Full rate limiting configuration, with optional per-category policies.
 * Stored as a JSON blob under the `rateLimit` AppConfig key.
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
  /** Policy per mutazioni struttura company (funzioni, team, membri) */
  companyStructureMutations: RateLimitPolicySchema.optional(),
  /** Policy per trigger sync NAV (fornitori, ecc.) */
  navSyncTrigger: RateLimitPolicySchema.optional(),
  /** Policy per generazione export (PDF/XLSX): operazione CPU e memory bound */
  exportGeneration: RateLimitPolicySchema.optional(),
});

/**
 * LDAP connection resilience settings — timeouts, retries, and circuit-breaker parameters.
 * All values correspond to individual AppConfig keys under `auth.ldap.resilience.*`.
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
 * Visual weight of a band's badge, independent from its color — colors alone run out of
 * distinguishable steps once more than ~4 bands are configured, so emphasis is the second axis
 * an admin can use to rank severity (e.g. solid red "In ritardo grave" vs outline red "In ritardo").
 * - `outline`: transparent background, colored border and text
 * - `soft`: tinted background, colored border and text
 * - `solid`: fully filled background, contrast-picked text
 */
export const AlertBandEmphasisSchema = z.enum(['outline', 'soft', 'solid']);

/**
 * A single criticality band: rows whose days-to-deadline fall in
 * [minDaysToDeadline, maxDaysToDeadline) are shown with this color/label.
 * `maxDaysToDeadline: null` means "no upper bound" (furthest-out band).
 */
export const AlertBandSchema = z.object({
  minDaysToDeadline: z.number().int(),
  maxDaysToDeadline: z.number().int().nullable(),
  color: z.string().min(1),
  label: z.string().min(1),
  /** Defaulted so blobs written before emphasis existed keep parsing (and keep rendering as before). */
  emphasis: AlertBandEmphasisSchema.default('outline'),
});

/** Ordered list of criticality bands for one scope (default or a specific Phase override). */
export const AlertBandSetSchema = z.object({
  bands: z.array(AlertBandSchema).min(1),
});

/**
 * Badge for a row that has been explicitly marked as concluded. Not part of `AlertBandSetSchema`'s
 * ordered list: completion is a state, not a day range — there is nothing to match against.
 * Solid by default so a concluded row reads as a finished outcome rather than one more countdown.
 */
export const AlertOutcomeBandSchema = z.object({
  color: z.string().min(1),
  label: z.string().min(1),
  emphasis: AlertBandEmphasisSchema.default('solid'),
});

/**
 * Criticality thresholds for the collection-control alert engine (Fase 5).
 * Global default bands, with an optional per-Phase override (fallback to `default` when absent).
 * Stored as a JSON blob under the `collectionControl.alertThresholds` AppConfig key.
 */
export const CollectionAlertThresholdsSchema = z.object({
  default: AlertBandSetSchema,
  /** Keyed by `Phase.value` (the stable business key), not `Phase.id` — a generated UUID that
   * differs per environment/seed and would silently stop matching if this config were copied
   * across environments. */
  perPhaseOverride: z.record(z.string(), AlertBandSetSchema).optional(),
  /** Concluded on or before the last planned milestone's deadline. */
  completedBand: AlertOutcomeBandSchema.default({ color: '#15803D', label: 'Concluso', emphasis: 'solid' }),
  /** Concluded after it. Defaulted (rather than optional) so the two outcomes are always
   * distinguishable, even in a config blob written before completion tracking existed. */
  completedLateBand: AlertOutcomeBandSchema.default({ color: '#B91C1C', label: 'Concluso in ritardo', emphasis: 'solid' }),
});

export type AlertBandEmphasis = z.infer<typeof AlertBandEmphasisSchema>;
export type AlertBand = z.infer<typeof AlertBandSchema>;
export type AlertOutcomeBand = z.infer<typeof AlertOutcomeBandSchema>;
export type AlertBandSet = z.infer<typeof AlertBandSetSchema>;
export type CollectionAlertThresholds = z.infer<typeof CollectionAlertThresholdsSchema>;

export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>;
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type LdapResilienceConfig = z.infer<typeof LdapResilienceSchema>;

/**
 * Schema for the default Brand/Season context that applies to the organization.
 * Stored in AppConfig and used when no user preference has been set.
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

export type AppContextDefaults = z.infer<typeof AppContextDefaultsSchema>;
