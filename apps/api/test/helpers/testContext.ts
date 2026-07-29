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

import { ensureTestSchema, getTestPrismaClient } from './database';
import { createSilentLogger } from './logger';

import type { Context } from '../../src/lib/trpc';

/**
 * Crea un context di test con un utente reale del ruolo richiesto.
 *
 * @param role - Ruolo dell'utente di sessione. Default `admin`.
 */
export async function createTestContext(
  role: Role = 'admin'
): Promise<Context> {
  // Client condiviso del file di test, non uno nuovo: ogni client apre un pool
  // proprio. E lo schema va garantito qui — le spec che usano solo questo helper
  // non chiamano `setupTestDb()`, quindi senza `ensureTestSchema` funzionavano
  // solo di rimbalzo, quando un'altra suite aveva già creato le tabelle.
  const prisma = getTestPrismaClient();
  await ensureTestSchema(prisma);

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
