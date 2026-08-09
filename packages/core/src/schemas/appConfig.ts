import { z } from 'zod';

/**
 * Shape of a single AppConfig record as persisted in the database (generic KV entry).
 */
export const AppConfigSchema = z.object({
  /** Configuration identifier key */
  key: z.string().min(1),

  /** Configuration value (generic serializable object) */
  value: z.unknown(),

  /** Configuration version for managing updates */
  version: z.number().int().positive(),

  /** Configuration creation date */
  createdAt: z.date(),

  /** Last update date */
  updatedAt: z.date(),
});

/** TypeScript type inferred from `AppConfigSchema`. */
export type AppConfig = z.infer<typeof AppConfigSchema>;

/**
 * Rate limiting policy for a single endpoint category.
 * `keyBy` controls whether the limit is per IP address or per authenticated user.
 */
export const RateLimitPolicySchema = z.object({
  /** Maximum number of allowed requests */
  max: z.number().int().positive(),
  /** Time window (e.g. '1m', '15m', '2h') */
  timeWindow: z.string().min(2),
  /** Key type for rate limiting */
  keyBy: z.enum(['ip', 'userId', 'username']).default('ip'),
});

/**
 * Full rate limiting configuration, with optional per-category policies.
 * Stored as a JSON blob under the `rateLimit` AppConfig key.
 */
export const RateLimitConfigSchema = z.object({
  /** Policy for login endpoint */
  login: RateLimitPolicySchema.optional(),
  /** Policy for login endpoint, username key (anti password-spray distributed across multiple IPs) */
  loginByUsername: RateLimitPolicySchema.optional(),
  /** Policy for password change */
  passwordChange: RateLimitPolicySchema.optional(),
  /** Policy for password reset */
  passwordReset: RateLimitPolicySchema.optional(),
  /** Policy for configuration mutations */
  configMutations: RateLimitPolicySchema.optional(),
  /** Policy for user mutations */
  userMutations: RateLimitPolicySchema.optional(),
  /** Policy for section access override (sectionAccess.set) */
  sectionAccessSet: RateLimitPolicySchema.optional(),
  /** Policy for brand mutations */
  brandMutations: RateLimitPolicySchema.optional(),
  /** Policy for pending user email sending */
  pendingEmail: RateLimitPolicySchema.optional(),
  /** Policy for LDAP bind/search test */
  ldapTest: RateLimitPolicySchema.optional(),
  /** Policy for company structure mutations (functions, teams, members) */
  companyStructureMutations: RateLimitPolicySchema.optional(),
  /** Policy for triggering NAV sync (suppliers, etc.) */
  navSyncTrigger: RateLimitPolicySchema.optional(),
  /** Policy for export generation (PDF/XLSX): CPU and memory bound operation */
  exportGeneration: RateLimitPolicySchema.optional(),
});

/**
 * LDAP connection resilience settings — timeouts, retries, and circuit-breaker parameters.
 * All values correspond to individual AppConfig keys under `auth.ldap.resilience.*`.
 */
export const LdapResilienceSchema = z.object({
  /** Timeout for LDAP operation in milliseconds */
  timeoutMs: z.number().int().positive().default(3000),
  /** Maximum number of retries for failed operations */
  maxRetries: z.number().int().min(0).default(2),
  /** Base delay for exponential backoff in milliseconds */
  baseDelayMs: z.number().int().min(10).default(200),
  /** Failure threshold to open circuit breaker */
  breakerFailureThreshold: z.number().int().min(1).default(5),
  /** Circuit breaker cooldown in milliseconds */
  breakerCooldownMs: z.number().int().min(500).default(10000),
  /** Maximum number of attempts in half-open state */
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
