/**
 * Helper per creare context di test per tRPC
 * Simula il context reale con Prisma e session mock
 */

import { PrismaClient } from '@prisma/client';
import type { Context } from '../src/lib/trpc';

export async function createTestContext(): Promise<Context> {
  // Crea istanza Prisma per test
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'file:./test.db',
      },
    },
  });

  // Mock session per test
  const mockSession = {
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      role: 'admin' as const,
      tokenVersion: 0,
    },
  };

  // Mock request e response
  const mockReq = {
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    headers: {},
    ip: '127.0.0.1',
  } as any;

  const mockRes = {} as any;

  return {
    prisma,
    session: mockSession,
    req: mockReq,
    res: mockRes,
    traceId: 'test-trace-id',
    logger: mockReq.log,
  };
}
