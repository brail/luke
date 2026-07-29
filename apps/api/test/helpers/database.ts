/**
 * Helper per il database di test (PostgreSQL).
 *
 * I test di integrazione girano su un database dedicato, mai su quello di sviluppo
 * né su quello di produzione. L'URL arriva da `TEST_DATABASE_URL`; in mancanza le
 * suite **falliscono**, non si saltano: un job che riporta verde con zero test
 * eseguiti è peggio di un job rosso.
 *
 * ## Ciclo di vita
 *
 * Un solo client Prisma per file di test, creato pigramente e chiuso una volta sola
 * a fine file (vitest isola i moduli per file, quindi lo stato qui sotto è
 * per-file). L'isolamento fra test avviene per **troncamento dei dati**, non
 * riconnettendo il client.
 *
 * La versione precedente eseguiva `migrate deploy` ad ogni `beforeEach` e chiamava
 * `$disconnect()` ad ogni `afterEach` su un client condiviso a livello di modulo:
 * il pool veniva chiuso mentre altri riferimenti erano ancora vivi, con
 * `Cannot use a pool after calling end on the pool` a cascata sulle suite
 * successive. Il problema non erano le singole spec, era questo file.
 */

import { execSync } from 'child_process';
import { join } from 'path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/** Marcatore obbligatorio nel nome del database: impedisce di puntare a dev o produzione. */
const REQUIRED_DB_NAME_MARKER = 'test';

const API_ROOT = join(__dirname, '../../');

/** Client condiviso dal file di test corrente. */
let sharedClient: PrismaClient | null = null;

/** Elenco delle tabelle da troncare, risolto una volta e riusato. */
let truncatableTables: string[] | null = null;

/**
 * Restituisce l'URL del database di test, o `null` se non configurato.
 *
 * Non usa mai `DATABASE_URL` come fallback: qui si eseguono operazioni distruttive,
 * e un fallback silenzioso sul DB di sviluppo lo azzererebbe.
 */
export function getTestDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;

  // Il nome del database deve contenere "test": guardia contro un URL incollato
  // per sbaglio da un ambiente reale.
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.includes(REQUIRED_DB_NAME_MARKER)) {
    throw new Error(
      `TEST_DATABASE_URL punta al database "${dbName}", che non contiene "${REQUIRED_DB_NAME_MARKER}". ` +
        'Rifiuto di eseguire operazioni distruttive su un database che potrebbe non essere di test.'
    );
  }

  return url;
}

/** URL di test, o eccezione con istruzioni se manca. */
function requireTestDatabaseUrl(): string {
  const url = getTestDatabaseUrl();
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL non configurato. Avvia il database di test con `pnpm test:db:up`.'
    );
  }
  return url;
}

/**
 * Crea un nuovo client Prisma legato al database di test.
 *
 * Preferire `getTestPrismaClient()`: ogni client apre un pool proprio, e più pool
 * sullo stesso file di test si esauriscono a vicenda.
 */
export function createTestPrismaClient(): PrismaClient {
  const url = requireTestDatabaseUrl();

  // Prisma 7 ha rimosso sia `datasources` sia `datasourceUrl` dal costruttore:
  // l'unico modo per puntare a un database specifico è il driver adapter, lo
  // stesso che usa `server.ts` in produzione.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Client condiviso del file di test corrente, creato al primo accesso. */
export function getTestPrismaClient(): PrismaClient {
  sharedClient ??= createTestPrismaClient();
  return sharedClient;
}

/**
 * Applica le migrazioni se lo schema non è ancora presente.
 *
 * `migrate deploy` è idempotente ma costa ~1s di processo esterno: eseguirlo ad
 * ogni test rendeva le suite di integrazione inutilizzabili. Qui si paga solo
 * quando il database è davvero vuoto.
 */
export async function ensureTestSchema(
  prisma: PrismaClient = getTestPrismaClient()
): Promise<void> {
  const [{ present }] = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
    ) AS present
  `;

  if (present) return;

  // L'URL arriva da prisma.config.ts, che legge DATABASE_URL dall'env.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: API_ROOT,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: requireTestDatabaseUrl() },
  });
}

/**
 * Svuota tutte le tabelle applicative, lasciando intatto lo schema.
 *
 * È il meccanismo di isolamento fra test: molto più rapido di ricreare lo schema,
 * e soprattutto non tocca la connessione.
 */
export async function resetTestData(
  prisma: PrismaClient = getTestPrismaClient()
): Promise<void> {
  if (!truncatableTables) {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    truncatableTables = rows.map(r => r.tablename);
  }

  if (truncatableTables.length === 0) return;

  // `$executeRawUnsafe` è inevitabile: i nomi di tabella sono identificatori, non
  // parametri, e non sono esprimibili con Prisma.sql. Le stringhe arrivano da
  // pg_tables del database di test, non da input utente.
  const list = truncatableTables.map(t => `"public"."${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`
  );
}

/**
 * Prepara il database per un test e restituisce il client condiviso.
 *
 * Idempotente e sicuro da chiamare in `beforeEach`: applica lo schema solo se
 * manca, poi tronca i dati. Non apre né chiude connessioni.
 */
export async function setupTestDb(): Promise<PrismaClient> {
  requireTestDatabaseUrl();

  const prisma = getTestPrismaClient();
  await ensureTestSchema(prisma);
  await resetTestData(prisma);

  return prisma;
}

/**
 * No-op storico, mantenuto perché invocato da molte spec in `afterEach`.
 *
 * Disconnettere qui è esattamente il bug che questo file risolve: la chiusura
 * avviene una volta sola per file, in `disconnectTestDb()`, chiamata dal setup
 * globale di vitest.
 */
export async function teardownTestDb(): Promise<void> {
  // intenzionalmente vuoto — vedi `disconnectTestDb`
}

/** Chiude il client condiviso. Chiamata una sola volta a fine file di test. */
export async function disconnectTestDb(): Promise<void> {
  if (!sharedClient) return;

  await sharedClient.$disconnect();
  sharedClient = null;
  truncatableTables = null;
}
