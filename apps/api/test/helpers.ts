/**
 * Test Helpers per Luke API
 * Utilities per mock context, caller factory e gestione DB isolato
 */

import { randomUUID } from 'crypto';

import helmet from '@fastify/helmet';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';

import { buildHelmetConfig } from '../src/lib/helmet';
import { hashPassword } from '../src/lib/password';
import { type Context } from '../src/lib/trpc';
import { appRouter } from '../src/routers/index';

import { setupTestDb as setupSharedTestDb } from './helpers/database';
import { createSilentLogger } from './helpers/logger';

import type { UserSession } from '../src/lib/auth';

/**
 * Database di test isolato
 */
let testPrisma: PrismaClient;

/**
 * Inizializza il database di test.
 * Delega a `helpers/database.ts`, unica fonte per l'URL e il reset dello schema.
 */
export async function setupTestDb(): Promise<PrismaClient> {
  testPrisma = await setupSharedTestDb();
  return testPrisma;
}

/**
 * Password degli utenti di test. Serve ai test che esercitano `me.changePassword`:
 * senza credenziale locale il router risponde FORBIDDEN ("cambio password non
 * consentito per provider esterni") invece di UNAUTHORIZED, e il test finisce per
 * misurare il ramo sbagliato.
 */
export const TEST_USER_PASSWORD = 'TestPassw0rd!23';

/**
 * Hash della password di test, calcolato una sola volta per file.
 *
 * `ARGON2_OPTIONS` è tarato per la produzione (64 MB, 3 iterazioni): ~90ms per
 * hash. La password è una costante, quindi rifare l'hash a ogni `createTestUser`
 * significava ~3s per run di integrazione per produrre decine di volte lo stesso
 * risultato. Memoizza la promise, non la stringa: chiamate concorrenti
 * condividono lo stesso calcolo invece di avviarne uno a testa.
 */
let testPasswordHash: Promise<string> | null = null;

function getTestPasswordHash(): Promise<string> {
  testPasswordHash ??= hashPassword(TEST_USER_PASSWORD);
  return testPasswordHash;
}

/**
 * Crea un utente di test con ruolo specificato, completo di identità locale e
 * credenziale — cioè un utente locale reale, non un guscio.
 */
export async function createTestUser(
  role: 'admin' | 'editor' | 'viewer'
): Promise<{
  user: any;
  session: UserSession;
}> {
  // Genera identificatori univoci usando timestamp + random
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const uniqueId = `${timestamp}-${random}`;
  
  const user = await testPrisma.user.create({
    data: {
      email: `${role}-${uniqueId}@test.com`,
      username: `${role}-${uniqueId}`,
      firstName: role.charAt(0).toUpperCase() + role.slice(1),
      lastName: 'User',
      role,
      isActive: true,
      emailVerifiedAt: new Date(), // Campo richiesto per i test
    },
  });

  // Crea identità locale + credenziale per l'utente
  const identity = await testPrisma.identity.create({
    data: {
      userId: user.id,
      provider: 'LOCAL',
      providerId: `${role}-${uniqueId}`, // Assicura unicità
    },
  });

  await testPrisma.localCredential.create({
    data: {
      identityId: identity.id,
      passwordHash: await getTestPasswordHash(),
    },
  });

  const session: UserSession = {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 0,
    },
  };

  return { user, session };
}

/**
 * Crea un context di test con sessione opzionale
 */
export function createTestContext(session: UserSession | null = null): Context {
  return {
    prisma: testPrisma,
    session,
    logger: createSilentLogger(),
    req: {
      headers: { 'x-luke-trace-id': randomUUID() },
      ip: '127.0.0.1',
      log: createSilentLogger(),
    } as any,
    res: {} as any,
    traceId: randomUUID(),
  };
}

/**
 * Crea un caller tRPC per un ruolo specifico
 */
export async function createCallerAs(
  role: 'admin' | 'editor' | 'viewer' | null
) {
  if (role === null) {
    // Nessuna sessione (non autenticato)
    const ctx = createTestContext(null);
    return appRouter.createCaller(ctx);
  }

  // Crea utente e sessione per il ruolo
  const { session } = await createTestUser(role);
  const ctx = createTestContext(session);
  return appRouter.createCaller(ctx);
}

/**
 * Crea un caller tRPC con sessione specifica
 */
export function createCallerWithSession(session: UserSession) {
  const ctx = createTestContext(session);
  return appRouter.createCaller(ctx);
}

/**
 * Crea un caller tRPC senza autenticazione
 */
export function createAnonymousCaller() {
  return createCallerAs(null);
}

/**
 * Crea un caller tRPC con idempotency-key specifica
 */
export async function createCallerWithIdempotency(
  idempotencyKey: string,
  role: 'admin' | 'editor' | 'viewer' | null = null
) {
  const base = role
    ? createTestContext((await createTestUser(role)).session)
    : createTestContext(null);
  const ctx: Context = {
    ...base,
    req: {
      ...base.req,
      headers: { ...base.req.headers, 'idempotency-key': idempotencyKey },
    },
  };
  return appRouter.createCaller(ctx);
}

/**
 * Crea un caller tRPC con IP specifico (per test rate-limit)
 */
export async function createCallerWithIP(
  ip: string,
  role: 'admin' | 'editor' | 'viewer' | null = null
) {
  const base = role
    ? createTestContext((await createTestUser(role)).session)
    : createTestContext(null);
  const ctx: Context = { ...base, req: { ...base.req, ip } };
  return appRouter.createCaller(ctx);
}

/**
 * Helper per aspettare che una promessa venga risolta o rifiutata
 */
export async function expectToThrow<T>(
  promise: Promise<T>,
  expectedError?: { code?: string; message?: string }
): Promise<void> {
  // Il caso "non ha lanciato" va distinto PRIMA di entrare nel catch: la versione
  // precedente lanciava dentro il `try`, il proprio `catch` intercettava
  // quell'Error (che non ha `.code`) e riportava "Expected error code 'X', got
  // 'undefined'" — cioè un fallimento di codice errore al posto di "la promise si
  // è risolta". Diagnosi sbagliata su ogni test di questo tipo.
  let caught: any;
  let threw = false;

  try {
    await promise;
  } catch (error) {
    threw = true;
    caught = error;
  }

  if (!threw) {
    throw new Error('Expected promise to throw, but it resolved');
  }

  if (expectedError) {
    if (expectedError.code && caught.code !== expectedError.code) {
      throw new Error(
        `Expected error code '${expectedError.code}', got '${caught.code}'`
      );
    }
    if (
      expectedError.message &&
      !caught.message.includes(expectedError.message)
    ) {
      throw new Error(
        `Expected error message to contain '${expectedError.message}', got '${caught.message}'`
      );
    }
  }
}

/**
 * Helper per verificare che un'operazione sia negata
 */
export async function expectUnauthorized(
  operation: () => Promise<any>,
  expectedCode: 'UNAUTHORIZED' | 'FORBIDDEN' = 'FORBIDDEN'
): Promise<void> {
  try {
    await operation();
    throw new Error('Expected operation to be unauthorized, but it succeeded');
  } catch (error: any) {
    if (error.code !== expectedCode) {
      throw new Error(
        `Expected error code '${expectedCode}', got '${error.code}': ${error.message}`
      );
    }
  }
}

/**
 * Crea un server Fastify isolato per test HTTP
 * Registra solo i plugin essenziali per testare security headers
 */
export async function buildTestServer() {
  const fastify = Fastify({
    logger: false, // Disabilita logging per test
  });

  // Registra Helmet con configurazione per test
  await fastify.register(helmet, buildHelmetConfig('test'));

  // Registra route di test per verificare headers
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: 'test',
      environment: 'test',
    };
  });

  // Route root per test
  fastify.get('/', async () => {
    return {
      message: 'Luke API Test Server',
      version: 'test',
    };
  });

  await fastify.ready();
  return fastify;
}

/**
 * Re-export dei moduli sotto `helpers/`, che rendono questo file il barrel unico
 * della superficie di test.
 *
 * **Sono load-bearing anche se nessuna spec importa da qui.** Non servono la
 * comodità: servono a far collidere i nomi. Due helper omonimi in file diversi
 * diventano qui un errore di compilazione, invece di due import che sembrano
 * intercambiabili e non lo sono. È già successo — `createTestContext` esisteva
 * sincrono in questo file (prende una `UserSession`, non tocca il database) e
 * asincrono in `helpers/testContext.ts` (crea un utente vero e tronca i dati),
 * e la scelta fra i due dipendeva da quale path avevi importato.
 *
 * Espliciti e non `export *`: le collisioni di `export *` cadono sotto TS2308,
 * che ha casi limite di risoluzione dell'ambiguità; una re-export esplicita
 * duplicata è un errore netto e immediato.
 *
 * Aggiungendo un export a un modulo `helpers/`, aggiungilo anche qui — è ciò
 * che tiene attivo il controllo.
 */
export { createContextForRole } from './helpers/testContext';
export { createSilentLogger } from './helpers/logger';
export {
  getTestDatabaseUrl,
  createTestPrismaClient,
  getTestPrismaClient,
  ensureTestSchema,
  resetTestData,
  disconnectTestDb,
} from './helpers/database';
export {
  MockStorageProvider,
  createTestContextWithMockStorage,
  createTestFile,
  createValidPngBuffer,
  createValidJpegBuffer,
  createInvalidImageBuffer,
} from './helpers/storageTestHelper';
