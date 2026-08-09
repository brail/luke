import mssql from 'mssql';

import type { NavDbConfig } from './config.js';

/**
 * Result of a single diagnostic step in a NAV connection test.
 */
export interface NavConnectionStep {
  name: string;
  ok: boolean;
  message: string;
}

/**
 * Runs a full diagnostic against a NAV SQL Server using a temporary isolated pool:
 * 1. SQL Server authentication (host, port, credentials, database)
 * 2. SELECT 1 query (confirms DB access)
 * 3. Existence of at least one table with the `[COMPANY$]` prefix (validates company name)
 *
 * Does not affect the production singleton pool.
 */
export async function testNavConnection(config: NavDbConfig): Promise<{
  success: boolean;
  steps: NavConnectionStep[];
}> {
  const steps: NavConnectionStep[] = [];
  let testPool: mssql.ConnectionPool | null = null;

  // Step 1: connection + SQL Server authentication
  try {
    testPool = await new mssql.ConnectionPool({
      server: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        readOnlyIntent: config.readOnly,
        connectTimeout: 10_000,
      },
      pool: { max: 1, min: 0, idleTimeoutMillis: 5_000 },
    }).connect();

    steps.push({
      name: 'Autenticazione SQL Server',
      ok: true,
      message: `Connesso a ${config.host}:${config.port} — database "${config.database}" accessibile`,
    });
  } catch (err: unknown) {
    const msg: string = err instanceof Error ? err.message : String(err);
    const hint = msg.includes('Login failed')
      ? 'Credenziali non valide.'
      : msg.includes('Cannot open database')
        ? `Database "${config.database}" non trovato o non accessibile.`
        : msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')
          ? `Impossibile raggiungere ${config.host}:${config.port}.`
          : msg;
    steps.push({ name: 'Autenticazione SQL Server', ok: false, message: hint });
    return { success: false, steps };
  }

  // Step 2: basic query
  try {
    await testPool.request().query('SELECT 1 AS ping');
    steps.push({
      name: 'SQL Query',
      ok: true,
      message: 'Database is responding correctly',
    });
  } catch (err: unknown) {
    steps.push({
      name: 'SQL Query',
      ok: false,
      message: `Query error: ${err instanceof Error ? err.message : String(err)}`,
    });
    await testPool.close().catch(() => {});
    return { success: false, steps };
  }

  // Step 3: verify that at least one table exists with prefix [COMPANY$]
  // We don't assume a specific table: NAV can have custom tables
  // and the company prefix is the only reliable identifier.
  try {
    const res = await testPool.request().input('prefix', `${config.company}$%`)
      .query<{ TABLE_NAME: string }>(`
        SELECT TOP 1 TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE @prefix
          AND TABLE_TYPE = 'BASE TABLE'
      `);

    if (res.recordset.length === 0) {
      steps.push({
        name: 'Company Verification',
        ok: false,
        message: `No table found with prefix "${config.company}$". Please verify the Company name.`,
      });
      await testPool.close().catch(() => {});
      return { success: false, steps };
    }

    steps.push({
      name: 'Company Verification',
      ok: true,
      message: `Company "${config.company}" verified (table: ${res.recordset[0].TABLE_NAME})`,
    });
  } catch (err: unknown) {
    steps.push({
      name: 'Company Verification',
      ok: false,
      message: `Company verification error: ${err instanceof Error ? err.message : String(err)}`,
    });
    await testPool.close().catch(() => {});
    return { success: false, steps };
  }

  await testPool.close().catch(() => {});
  return { success: true, steps };
}

let pool: mssql.ConnectionPool | null = null;
let currentConfig: NavDbConfig | null = null;
/**
 * In-flight connect promise shared across concurrent calls.
 * Prevents two simultaneous callers from creating two separate pools.
 */
let connectingPromise: Promise<mssql.ConnectionPool> | null = null;

function configChanged(a: NavDbConfig, b: NavDbConfig): boolean {
  return (
    a.host !== b.host ||
    a.port !== b.port ||
    a.database !== b.database ||
    a.user !== b.user ||
    a.password !== b.password
  );
}

/**
 * Returns the mssql connection pool, creating or recreating it when the
 * configuration has changed. The pool is a per-process singleton.
 *
 * Concurrent callers during an in-flight connect await the same Promise
 * instead of opening duplicate pools.
 *
 * `readOnly=true` sets `ApplicationIntent=ReadOnly`, useful with SQL Server
 * Availability Groups to route reads to the secondary replica.
 */
export async function getPool(
  config: NavDbConfig
): Promise<mssql.ConnectionPool> {
  // If config has changed (including password), close existing pool
  if (pool && currentConfig && configChanged(config, currentConfig)) {
    connectingPromise = null;
    await pool.close();
    pool = null;
    currentConfig = null;
  }

  // Pool already connected: return it immediately
  if (pool?.connected) return pool;

  // Connect in progress: return the same Promise to avoid duplicate pools
  if (connectingPromise) return connectingPromise;

  connectingPromise = new mssql.ConnectionPool({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      readOnlyIntent: config.readOnly,
    },
    requestTimeout: 300_000, // 5 min — portfolio order query can take 3–4 minutes
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  })
    .connect()
    .then(p => {
      pool = p;
      currentConfig = config;
      connectingPromise = null;
      return p;
    })
    .catch(err => {
      connectingPromise = null;
      throw err;
    });

  return connectingPromise;
}

/**
 * Closes the singleton mssql pool and resets all connection state.
 * Safe to call when no pool is open (no-op).
 */
export async function closePool(): Promise<void> {
  connectingPromise = null;
  if (pool) {
    await pool.close();
    pool = null;
    currentConfig = null;
  }
}
