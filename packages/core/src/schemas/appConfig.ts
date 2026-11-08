import { z } from 'zod';

const WINDOW_UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;
type WindowUnit = keyof typeof WINDOW_UNIT_MS;
const RATE_LIMIT_TIME_WINDOW = new RegExp(`^(\\d+)(${Object.keys(WINDOW_UNIT_MS).join('|')})$`);

/**
 * Milliseconds of a rate-limit window — a whole number of seconds, minutes or hours (`30s`, `1m`,
 * `2h`), longer than zero — or `null` for any other string, and for a numeral too long to compute
 * (`Infinity` would never let a window end). No upper bound on purpose: a stored window works at
 * any length, and a cap would send a working one back to its default (owner, 2026-11-08).
 */
export function rateLimitWindowMs(window: string): number | null {
  const match = RATE_LIMIT_TIME_WINDOW.exec(window);
  // The pattern's unit group alternates exactly the map's keys.
  const ms = match ? Number(match[1]) * WINDOW_UNIT_MS[match[2] as WindowUnit] : 0;
  return ms > 0 && Number.isFinite(ms) ? ms : null;
}

/**
 * Rate limiting policy for a single endpoint category.
 * `keyBy` controls whether the limit is per IP address or per authenticated user.
 */
export const RateLimitPolicySchema = z.object({
  /** Maximum number of allowed requests */
  max: z.number().int().positive(),
  /** Time window (e.g. '1m', '15m', '2h'), longer than zero */
  timeWindow: z
    .string()
    .refine(window => rateLimitWindowMs(window) !== null, 'Expected a window longer than zero, such as 30s, 1m or 2h'),
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
  /** Policy for the Google OAuth code exchange, per IP (its account bucket is `configMutations`) */
  googleOAuthExchange: RateLimitPolicySchema.optional(),
});

/**
 * LDAP connection resilience settings — timeouts, retries, and circuit-breaker parameters.
 * All values correspond to individual AppConfig keys under `auth.ldap.resilience.*`, whose
 * bounds live on the registry schema and defaults in `APP_CONFIG_DEFAULTS` (`config.ts`), once:
 * this is only the shape the reader assembles from values the registry has already validated.
 */
export const LdapResilienceSchema = z.object({
  /** Timeout for LDAP operation in milliseconds */
  timeoutMs: z.number().int(),
  /** Maximum number of retries for failed operations */
  maxRetries: z.number().int(),
  /** Base delay for exponential backoff in milliseconds */
  baseDelayMs: z.number().int(),
  /** Failure threshold to open circuit breaker */
  breakerFailureThreshold: z.number().int(),
  /** Circuit breaker cooldown in milliseconds */
  breakerCooldownMs: z.number().int(),
  /** Probes the directory must answer, one at a time, to close the breaker from half-open */
  halfOpenMaxAttempts: z.number().int(),
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
  // `{ error }` names an emptied field (NaN), reported in English otherwise (see `intInRange`).
  minDaysToDeadline: z.number({ error: 'I giorni di ogni fascia devono essere numeri interi' }).int('I giorni di ogni fascia devono essere numeri interi'),
  maxDaysToDeadline: z.number({ error: 'I giorni di ogni fascia devono essere numeri interi' }).int('I giorni di ogni fascia devono essere numeri interi').nullable(),
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
      brandId: z.uuid().optional(),
      seasonId: z.uuid().optional(),
    })
    .optional()
    .default({}),
});

export type AppContextDefaults = z.infer<typeof AppContextDefaultsSchema>;
