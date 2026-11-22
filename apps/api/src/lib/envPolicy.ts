import { tlsVerificationOffProblem } from '@luke/core';

import type { FastifyBaseLogger } from 'fastify';

/**
 * POLICY: Bootstrap env guard (API server)
 *
 * Only infrastructure variables are allowed in process.env.
 * Any application configuration (credentials, secrets, external endpoints)
 * must live in AppConfig (database). If a forbidden variable is detected:
 *   - in production: the server refuses to start (`EnvPolicyError`, exit 1)
 *   - otherwise: an explicit warning is emitted
 *
 * Allowed variables (API):
 *   DATABASE_URL              — Prisma, needed before DB boot
 *   PORT, HOST                — server bind
 *   NODE_ENV                  — standard runtime
 *   APP_VERSION               — build-time release identity (Docker ARG/ENV from the git tag)
 *   LUKE_CORS_ALLOWED_ORIGINS — deploy CORS override (not a secret)
 *   LUKE_TRUSTED_PROXY_CIDR   — reverse-proxy range for `trustProxy`, read before any DB exists
 *   OTEL_*, LOG_LEVEL         — observability infra
 *
 * Web container exceptions (not touched by this guard):
 *   NEXTAUTH_SECRET, NEXTAUTH_URL — NextAuth framework constraint
 *   INTERNAL_API_URL              — Next.js rewrites, resolved at build time
 *   NEXT_PUBLIC_*                 — baked into the client bundle, impossible from DB
 *   COOKIE_SECURE                 — HTTP vs HTTPS deploy setting
 */
const FORBIDDEN_ENV_PATTERNS: RegExp[] = [
  /^SMTP_/i,
  /^LDAP_/i,
  /^JWT_/i,
  /^NEXTAUTH_/i,
  /.*_SECRET$/i,
  /.*_PASSWORD$/i,
  /.*_API_KEY$/i,
  /.*_TOKEN$/i,
];

export class EnvPolicyError extends Error {}

/**
 * Enforces the env-var policy above, plus `NODE_TLS_REJECT_UNAUTHORIZED=0`: throws
 * `EnvPolicyError` in production, warns otherwise.
 *
 * @param env    `process.env`, `NODE_ENV` included. Tests pass their own.
 * @param logger Receives one warning per kind of problem outside production.
 */
export function assertEnvPolicy(env: NodeJS.ProcessEnv, logger: Pick<FastifyBaseLogger, 'warn'>): void {
  const problems: string[] = [];

  const violations = Object.keys(env).filter(key => FORBIDDEN_ENV_PATTERNS.some(p => p.test(key)));
  if (violations.length > 0) {
    problems.push(
      `Application variables found in process.env — they must live in AppConfig: ${violations.join(', ')}`
    );
  }

  const tlsProblem = tlsVerificationOffProblem(env);
  if (tlsProblem) problems.push(tlsProblem);

  if (problems.length === 0) return;

  if (env.NODE_ENV === 'production') {
    throw new EnvPolicyError(`[env-policy] ${problems.join(' ')}`);
  }
  for (const problem of problems) logger.warn(`[env-policy] ${problem}`);
}
