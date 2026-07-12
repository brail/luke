/**
 * Extensible readiness check system.
 *
 * Provides modular checks (database, secrets, LDAP) that are run in parallel
 * and aggregated into a single status response. New checks can be added to
 * `getReadinessChecks` without modifying the runner or HTTP route.
 */

import { Client } from 'ldapts';

import { deriveSecret, validateMasterKey } from '@luke/core/server';

import { getLdapConfig } from '../lib/configManager';

import type { PrismaClient } from '@prisma/client';
import type { FastifyLoggerInstance } from 'fastify';


/** Describes a single readiness check with a name and an async probe function. */
export interface ReadinessCheck {
  name: string;
  check: () => Promise<{ ok: boolean; message?: string }>;
}

/**
 * Probes the database connection by executing `SELECT 1`.
 *
 * @returns `{ ok: true }` on success, or `{ ok: false, message }` on failure.
 */
export async function checkDatabase(
  prisma: PrismaClient
): Promise<{ ok: boolean; message?: string }> {
  try {
    // Raw SQL exemption (CLAUDE.md Stack Constraints): health-probe query.
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error: any) {
    return { ok: false, message: error.message };
  }
}

/**
 * Verifies that HKDF secret derivation is operational by performing a test derivation.
 *
 * @returns `{ ok: true }` on success, or `{ ok: false, message }` if derivation fails.
 */
export async function checkSecrets(): Promise<{
  ok: boolean;
  message?: string;
}> {
  try {
    deriveSecret('api.jwt'); // Test derivazione
    return { ok: true };
  } catch (error: any) {
    return { ok: false, message: 'Secret derivation failed' };
  }
}

/**
 * Probes the LDAP server with a bind/unbind cycle if LDAP is enabled in AppConfig.
 *
 * Skips and returns `ok: true` when LDAP is disabled. Uses a 2-second connect/operation timeout.
 *
 * @returns `{ ok: true }` on success, or `{ ok: false, message }` if the bind fails.
 */
export async function checkLdap(
  prisma: PrismaClient
): Promise<{ ok: boolean; message?: string }> {
  try {
    const config = await getLdapConfig(prisma);
    if (!config.enabled) {
      return { ok: true, message: 'LDAP disabled, skipped' };
    }

    // Ping LDAP con timeout breve (ldapts: connessione lazy al primo bind)
    const client = new Client({
      url: config.url,
      timeout: 2000,
      connectTimeout: 2000,
    });

    try {
      await client.bind(config.bindDN, config.bindPassword);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: `LDAP bind failed: ${err.message}` };
    } finally {
      try {
        await client.unbind();
      } catch {
        // ignore
      }
    }
  } catch (error: any) {
    return { ok: false, message: error.message };
  }
}

/**
 * Returns the list of all registered readiness checks.
 *
 * Add new entries here to extend the `/readyz` probe with additional integrations
 * (e.g. SAP, external APIs) without modifying the runner or the HTTP route.
 */
export function getReadinessChecks(prisma: PrismaClient): ReadinessCheck[] {
  return [
    { name: 'database', check: () => checkDatabase(prisma) },
    { name: 'secrets', check: () => checkSecrets() },
    { name: 'ldap', check: () => checkLdap(prisma) },
    // Futuro: { name: 'sap', check: () => checkSap(prisma) }
    // Futuro: { name: 'external-api', check: () => checkExternalApi(prisma) }
  ];
}

/**
 * Runs all registered readiness checks in parallel and aggregates the results.
 *
 * @returns An object with `allOk` (true if every check passed), a per-check status map,
 *          and the current ISO timestamp.
 */
export async function runReadinessChecks(prisma: PrismaClient): Promise<{
  allOk: boolean;
  checks: Record<string, string>;
  timestamp: string;
}> {
  const checks = getReadinessChecks(prisma);
  const results = await Promise.allSettled(
    checks.map(async c => ({ name: c.name, ...(await c.check()) }))
  );

  const checksStatus: Record<string, string> = {};
  let allOk = true;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { name, ok, message } = result.value;
      checksStatus[name] = ok ? 'ok' : `failed: ${message}`;
      if (!ok) allOk = false;
    } else {
      checksStatus['unknown'] = 'error';
      allOk = false;
    }
  }

  return {
    allOk,
    checks: checksStatus,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Performs fail-fast checks that must pass before the server accepts traffic.
 *
 * Verifies: database connectivity, master key availability, and JWT secret derivation.
 * Throws a detailed error if any check fails, allowing the boot sequence to exit cleanly.
 */
export async function checkBootstrapDependencies(
  prisma: PrismaClient,
  logger: FastifyLoggerInstance
): Promise<void> {
  try {
    // Test connessione database
    await prisma.$connect();
    logger.info('Connessione database stabilita');

    // Test master key availability
    if (!validateMasterKey()) {
      const error = new Error('Master key non disponibile o invalida');
      logger.error(error.message);
      throw error;
    }

    // Test secret derivation
    try {
      deriveSecret('api.jwt');
      logger.info('Segreti JWT derivati con successo');
    } catch (error: any) {
      const secretError = new Error(
        `Impossibile derivare segreti JWT: ${error.message}`
      );
      logger.error(secretError.message);
      throw secretError;
    }
  } catch (error: any) {
    // Re-throw con messaggio dettagliato per debugging
    const bootstrapError = new Error(
      `Bootstrap dependency check failed: ${error.message}`
    );
    logger.error(
      { error: bootstrapError },
      'Errore verifica dipendenze bootstrap'
    );
    throw bootstrapError;
  }
}
