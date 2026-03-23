import mssql from 'mssql';

import type { NavDbConfig } from './config.js';

let pool: mssql.ConnectionPool | null = null;
let currentConfig: NavDbConfig | null = null;
/**
 * In-flight connect promise condivisa tra chiamate concorrenti.
 * Evita che due caller simultanei creino due pool distinti.
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
 * Restituisce il connection pool mssql, creandolo o ricreandolo se la
 * configurazione è cambiata. Il pool è un singleton per processo.
 *
 * Chiamate concorrenti durante la fase di connect attendono la stessa
 * Promise invece di aprire pool duplicati.
 *
 * readOnly=true imposta ApplicationIntent=ReadOnly (utile con SQL Server AG).
 */
export async function getPool(config: NavDbConfig): Promise<mssql.ConnectionPool> {
  // Se la config è cambiata (inclusa la password), chiudi il pool esistente
  if (pool && currentConfig && configChanged(config, currentConfig)) {
    connectingPromise = null;
    await pool.close();
    pool = null;
    currentConfig = null;
  }

  // Pool già connesso: restituiscilo subito
  if (pool?.connected) return pool;

  // Connect in corso: restituisci la stessa Promise per evitare pool duplicati
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

export async function closePool(): Promise<void> {
  connectingPromise = null;
  if (pool) {
    await pool.close();
    pool = null;
    currentConfig = null;
  }
}
