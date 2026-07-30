/**
 * Helper per creare context di test per tRPC.
 *
 * La sessione punta a un utente **realmente presente nel database**: i router di
 * produzione usano `protectedProcedure`, che valida `tokenVersion` contro la riga
 * utente. Con una sessione finta (`id: 'test-user-id'`) ogni chiamata falliva con
 * "Sessione scaduta" — motivo per cui le spec avevano preso l'abitudine di
 * duplicare i router usando `publicProcedure`.
 */

import { randomUUID } from 'crypto';

import type { Role } from '@luke/core';

import { ensureTestSchema, getTestPrismaClient, resetTestData } from './database';
import { createSilentLogger } from './logger';

import type { Context } from '../../src/lib/trpc';

/**
 * Crea un context di test con un utente reale del ruolo richiesto.
 *
 * Tronca i dati prima di costruire il context, così ogni test parte da un
 * database vuoto. Non è ridondante con le spec che chiamano già
 * `resetTestData()`: prima l'isolamento era una convenzione per-file, e bastava
 * un file senza pulizia iniziale per ereditare le righe di quello precedente.
 * È successo davvero — `brand.integration.spec.ts` non aveva `afterEach` e
 * lasciava un brand con codice fisso, che faceva fallire con P2002 le suite
 * successive. Su un database già popolato il difetto non si vedeva; è emerso
 * solo in CI, sul primo database davvero vuoto.
 *
 * Il nome dice il parametro di proposito. Si chiamava `createTestContext`, come
 * l'helper **sincrono** in `test/helpers.ts` che prende una `UserSession` e non
 * tocca il database: due funzioni omonime con semantiche incompatibili, scelte
 * per import. Con nomi distinti ogni confusione diventa un errore di
 * compilazione — import sbagliato, argomento sbagliato, o `await` mancante
 * (un `Promise<Context>` non ha `.prisma`).
 *
 * @param role - Ruolo dell'utente di sessione. Default `admin`.
 */
export async function createContextForRole(
  role: Role = 'admin'
): Promise<Context> {
  // Client condiviso del file di test, non uno nuovo: ogni client apre un pool
  // proprio. E lo schema va garantito qui — le spec che usano solo questo helper
  // non chiamano `setupTestDb()`, quindi senza `ensureTestSchema` funzionavano
  // solo di rimbalzo, quando un'altra suite aveva già creato le tabelle.
  const prisma = getTestPrismaClient();
  await ensureTestSchema(prisma);
  await resetTestData(prisma);

  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `ctx-${role}-${uid}@test.com`,
      username: `ctx-${role}-${uid}`,
      firstName: 'Ctx',
      lastName: 'Test',
      role,
      isActive: true,
    },
  });

  const session = {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
  };

  // Mock request e response
  const mockReq = {
    log: createSilentLogger(),
    headers: {},
    ip: '127.0.0.1',
  } as any;

  const mockRes = {} as any;

  return {
    prisma,
    session,
    req: mockReq,
    res: mockRes,
    traceId: randomUUID(),
    logger: mockReq.log,
  };
}
