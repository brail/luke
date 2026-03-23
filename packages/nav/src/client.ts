import mssql from 'mssql';

import type { NavDbConfig } from './config.js';

let pool: mssql.ConnectionPool | null = null;
let currentConfig: NavDbConfig | null = null;

function configChanged(a: NavDbConfig, b: NavDbConfig): boolean {
  return a.host !== b.host || a.port !== b.port || a.database !== b.database || a.user !== b.user;
}

/**
 * Restituisce il connection pool mssql, creandolo o ricreandolo se la
 * configurazione è cambiata. Il pool è un singleton per processo.
 *
 * readOnly=true imposta ApplicationIntent=ReadOnly (utile con SQL Server AG
 * read replicas). Su istanze standalone non ha effetto pratico ma rimane
 * come segnale architetturale.
 */
export async function getPool(config: NavDbConfig): Promise<mssql.ConnectionPool> {
  if (pool && currentConfig && configChanged(config, currentConfig)) {
    await pool.close();
    pool = null;
    currentConfig = null;
  }

  if (!pool || !pool.connected) {
    pool = await new mssql.ConnectionPool({
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
      pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30_000,
      },
    }).connect();
    currentConfig = config;
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    currentConfig = null;
  }
}
