import mssql from 'mssql';

import type { NavDbConfig } from './config.js';

export interface NavConnectionStep {
  name: string;
  ok: boolean;
  message: string;
}

/**
 * Esegue un test completo della connessione NAV su un pool temporaneo isolato:
 * 1. Autenticazione SQL Server (host, porta, credenziali, database)
 * 2. Query SELECT 1 (accesso DB confermato)
 * 3. Verifica tabella [COMPANY$Vendor] (nome company corretto)
 *
 * Non influenza il pool singleton di produzione.
 */
export async function testNavConnection(config: NavDbConfig): Promise<{
  success: boolean;
  steps: NavConnectionStep[];
}> {
  const steps: NavConnectionStep[] = [];
  let testPool: mssql.ConnectionPool | null = null;

  // Step 1: connessione + autenticazione SQL Server
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
  } catch (err: any) {
    const msg: string = err.message ?? String(err);
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

  // Step 2: query base
  try {
    await testPool.request().query('SELECT 1 AS ping');
    steps.push({ name: 'Query SQL', ok: true, message: 'Database risponde correttamente' });
  } catch (err: any) {
    steps.push({ name: 'Query SQL', ok: false, message: `Errore query: ${err.message}` });
    await testPool.close().catch(() => {});
    return { success: false, steps };
  }

  // Step 3: verifica che esista almeno una tabella con prefisso [COMPANY$]
  // Non si presuppone una tabella specifica: NAV può avere tabelle custom
  // e il prefisso company è l'unico identificatore affidabile.
  try {
    const res = await testPool
      .request()
      .input('prefix', `${config.company}$%`)
      .query<{ TABLE_NAME: string }>(`
        SELECT TOP 1 TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE @prefix
          AND TABLE_TYPE = 'BASE TABLE'
      `);

    if (res.recordset.length === 0) {
      steps.push({
        name: 'Verifica Company',
        ok: false,
        message: `Nessuna tabella con prefisso "${config.company}$" trovata. Verificare il nome della Company.`,
      });
      await testPool.close().catch(() => {});
      return { success: false, steps };
    }

    steps.push({
      name: 'Verifica Company',
      ok: true,
      message: `Company "${config.company}" verificata (tabella: ${res.recordset[0].TABLE_NAME})`,
    });
  } catch (err: any) {
    steps.push({
      name: 'Verifica Company',
      ok: false,
      message: `Errore verifica company: ${err.message ?? String(err)}`,
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
