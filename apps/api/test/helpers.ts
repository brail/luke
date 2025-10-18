/**
 * Test Helpers per Luke API
 * Utilities per mock context, caller factory e gestione DB isolato
 */

import { PrismaClient } from '@prisma/client';
import { appRouter } from '../src/routers/index';
import { createContext, type Context } from '../src/lib/trpc';
import { randomUUID } from 'crypto';
import type { UserSession } from '../src/lib/auth';

/**
 * Database di test isolato
 */
let testPrisma: PrismaClient;

/**
 * Inizializza il database di test
 */
export async function setupTestDb(): Promise<PrismaClient> {
  testPrisma = new PrismaClient({
    datasources: {
      db: {
        url: 'file:./test.db',
      },
    },
  });

  // Pulisci il database in modo sicuro (ignora errori se le tabelle non esistono)
  try {
    await testPrisma.auditLog.deleteMany();
  } catch (error) {
    // Ignora errori se la tabella non esiste
  }

  try {
    await testPrisma.localCredential.deleteMany();
  } catch (error) {
    // Ignora errori se la tabella non esiste
  }

  try {
    await testPrisma.identity.deleteMany();
  } catch (error) {
    // Ignora errori se la tabella non esiste
  }

  try {
    await testPrisma.user.deleteMany();
  } catch (error) {
    // Ignora errori se la tabella non esiste
  }

  try {
    await testPrisma.appConfig.deleteMany();
  } catch (error) {
    // Ignora errori se la tabella non esiste
  }

  return testPrisma;
}

/**
 * Pulisce il database di test
 */
export async function teardownTestDb(): Promise<void> {
  if (testPrisma) {
    // Pulisci il database in modo sicuro
    try {
      await testPrisma.auditLog.deleteMany();
    } catch (error) {
      // Ignora errori se la tabella non esiste
    }

    try {
      await testPrisma.localCredential.deleteMany();
    } catch (error) {
      // Ignora errori se la tabella non esiste
    }

    try {
      await testPrisma.identity.deleteMany();
    } catch (error) {
      // Ignora errori se la tabella non esiste
    }

    try {
      await testPrisma.user.deleteMany();
    } catch (error) {
      // Ignora errori se la tabella non esiste
    }

    try {
      await testPrisma.appConfig.deleteMany();
    } catch (error) {
      // Ignora errori se la tabella non esiste
    }

    await testPrisma.$disconnect();
  }
}

/**
 * Crea un utente di test con ruolo specificato
 */
export async function createTestUser(
  role: 'admin' | 'editor' | 'viewer'
): Promise<{
  user: any;
  session: UserSession;
}> {
  const user = await testPrisma.user.create({
    data: {
      email: `${role}@test.com`,
      username: role,
      firstName: role.charAt(0).toUpperCase() + role.slice(1),
      lastName: 'User',
      role,
      isActive: true,
    },
  });

  // Crea identità locale per l'utente
  await testPrisma.identity.create({
    data: {
      userId: user.id,
      provider: 'LOCAL',
      providerId: role,
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
    req: {
      headers: { 'x-luke-trace-id': randomUUID() },
      ip: '127.0.0.1',
      log: {
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
      },
    } as any,
    res: {} as any,
    traceId: randomUUID(),
  };
}

/**
 * Crea un caller tRPC per un ruolo specifico
 */
export function createCallerAs(role: 'admin' | 'editor' | 'viewer' | null) {
  if (role === null) {
    // Nessuna sessione (non autenticato)
    const ctx = createTestContext(null);
    return appRouter.createCaller(ctx);
  }

  // Crea utente e sessione per il ruolo
  const { session } = createTestUser(role);
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
 * Helper per aspettare che una promessa venga risolta o rifiutata
 */
export async function expectToThrow<T>(
  promise: Promise<T>,
  expectedError?: { code?: string; message?: string }
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to throw, but it resolved');
  } catch (error: any) {
    if (expectedError) {
      if (expectedError.code && error.code !== expectedError.code) {
        throw new Error(
          `Expected error code '${expectedError.code}', got '${error.code}'`
        );
      }
      if (
        expectedError.message &&
        !error.message.includes(expectedError.message)
      ) {
        throw new Error(
          `Expected error message to contain '${expectedError.message}', got '${error.message}'`
        );
      }
    }
  }
}

/**
 * Helper per verificare che un'operazione sia autorizzata
 */
export async function expectAuthorized<T>(
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') {
      throw new Error(`Operation was not authorized: ${error.message}`);
    }
    throw error;
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
 * Configurazione di test per RBAC
 */
export const RBAC_TEST_CONFIG = {
  roles: ['admin', 'editor', 'viewer'] as const,
  adminOnlyMutations: [
    'users.create',
    'users.update',
    'users.delete',
    'users.hardDelete',
    'users.revokeUserSessions',
    'config.set',
    'config.update',
    'config.delete',
    'integrations.storage.saveConfig',
    'integrations.mail.saveConfig',
    'integrations.auth.saveLdapConfig',
  ],
  adminOrEditorQueries: ['users.list'],
  protectedMutations: [
    'me.updateProfile',
    'me.changePassword',
    'me.revokeAllSessions',
  ],
  publicEndpoints: ['auth.login', 'integrations.test'],
} as const;
