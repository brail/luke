/**
 * Readiness Checks Estensibili
 * Sistema modulare per verifiche di readiness (DB, secrets, LDAP, integrations future)
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyLoggerInstance } from 'fastify';
import { deriveSecret, validateMasterKey } from '@luke/core/server';
import { getLdapConfig } from '../lib/configManager';
import * as ldap from 'ldapjs';

/**
 * Interfaccia per check di readiness
 */
export interface ReadinessCheck {
  name: string;
  check: () => Promise<{ ok: boolean; message?: string }>;
}

/**
 * Verifica connessione database
 */
export async function checkDatabase(
  prisma: PrismaClient
): Promise<{ ok: boolean; message?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (error: any) {
    return { ok: false, message: error.message };
  }
}

/**
 * Verifica derivazione segreti
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
 * Verifica connessione LDAP (se abilitato)
 */
export async function checkLdap(
  prisma: PrismaClient
): Promise<{ ok: boolean; message?: string }> {
  try {
    const config = await getLdapConfig(prisma);
    if (!config.enabled) {
      return { ok: true, message: 'LDAP disabled, skipped' };
    }

    // Ping LDAP con timeout breve
    return await new Promise(resolve => {
      const client = ldap.createClient({
        url: config.url,
        timeout: 2000,
        connectTimeout: 2000,
      });

      const timer = setTimeout(() => {
        client.destroy();
        resolve({ ok: false, message: 'LDAP timeout' });
      }, 2000);

      client.bind(config.bindDN, config.bindPassword, err => {
        clearTimeout(timer);
        client.unbind(() => {});

        if (err) {
          resolve({ ok: false, message: `LDAP bind failed: ${err.message}` });
        } else {
          resolve({ ok: true });
        }
      });
    });
  } catch (error: any) {
    return { ok: false, message: error.message };
  }
}

/**
 * Registry estensibile di readiness checks
 * Aggiungi nuovi check qui per integrations future (SAP, API esterne, etc.)
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
 * Esegue tutti i readiness checks in parallelo
 * Ritorna status aggregato con dettagli per ogni check
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
 * Verifica dipendenze critiche durante bootstrap (fail-fast)
 * Esegue controlli che devono passare prima che il server si avvii
 * Lancia errori dettagliati in caso di fallimento per debugging
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
