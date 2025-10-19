/**
 * Test di integrazione per Session Hardening
 * Verifica tokenVersion, invalidazione sessioni, TTL
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, createTestContext } from './helpers';
import { PrismaClient } from '@prisma/client';
import { appRouter } from '../src/routers/index';
import { hashPassword } from '../src/lib/password';
import { signJWT } from '../src/lib/jwt';
import { invalidateTokenVersionCache } from '../src/lib/trpc';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await setupTestDb();

  // Crea le tabelle nel database di test usando Prisma direttamente
  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "email" TEXT NOT NULL UNIQUE,
    "username" TEXT NOT NULL UNIQUE,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "locale" TEXT NOT NULL DEFAULT 'it-IT',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" DATETIME,
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "identities" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("provider", "providerId"),
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
  )`;

  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "local_credentials" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "identityId" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("identityId") REFERENCES "identities"("id") ON DELETE CASCADE
  )`;

  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "app_configs" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "key" TEXT NOT NULL UNIQUE,
    "value" TEXT NOT NULL,
    "isEncrypted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;

  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "userId" TEXT,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "metadata" TEXT,
    "traceId" TEXT,
    "ipAddress" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
  )`;

  // Seed config per cache TTL
  await prisma.appConfig.create({
    data: {
      key: 'security.tokenVersionCacheTTL',
      value: '60000',
      isEncrypted: false,
    },
  });
});

afterAll(async () => {
  await teardownTestDb();
});

describe('Session Hardening — tokenVersion', () => {
  it('Login → Call OK → ChangePassword → Call UNAUTHORIZED', async () => {
    // 1. Crea utente LOCAL con tokenVersion=0
    const passwordHash = await hashPassword('TestPass123!');

    const user = await prisma.user.create({
      data: {
        email: 'test@hardening.local',
        username: 'testuser',
        role: 'viewer',
        isActive: true,
        tokenVersion: 0,
      },
    });

    const identity = await prisma.identity.create({
      data: {
        userId: user.id,
        provider: 'LOCAL',
        providerId: 'testuser',
      },
    });

    await prisma.localCredential.create({
      data: {
        identityId: identity.id,
        passwordHash,
      },
    });

    // 2. Login simulato (genera token JWT con tokenVersion=0)
    const token = signJWT(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: 0,
      },
      { expiresIn: '8h' }
    );

    const session = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: 0,
      },
    };

    // 3. Call protetta → OK
    const ctx1 = createTestContext(session);
    const caller1 = appRouter.createCaller(ctx1);
    const profile1 = await caller1.me.get();
    expect(profile1.id).toBe(user.id);

    // 4. ChangePassword → tokenVersion++
    await caller1.me.changePassword({
      currentPassword: 'TestPass123!',
      newPassword: 'NewPass456!Longer',
      confirmNewPassword: 'NewPass456!Longer',
    });

    // Invalida cache manualmente (simula propagazione)
    invalidateTokenVersionCache(user.id);

    // 5. Verifica DB: tokenVersion=1
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(updatedUser?.tokenVersion).toBe(1);

    // 6. Call protetta con VECCHIO token (tokenVersion=0) → UNAUTHORIZED
    const ctx2 = createTestContext(session); // Session ancora con tokenVersion=0
    const caller2 = appRouter.createCaller(ctx2);

    await expect(caller2.me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('RevokeAllSessions → Vecchio token rifiutato', async () => {
    const passwordHash = await hashPassword('TestPass789!');

    const user = await prisma.user.create({
      data: {
        email: 'test2@hardening.local',
        username: 'testuser2',
        role: 'viewer',
        isActive: true,
        tokenVersion: 0,
      },
    });

    const identity = await prisma.identity.create({
      data: {
        userId: user.id,
        provider: 'LOCAL',
        providerId: 'testuser2',
      },
    });

    await prisma.localCredential.create({
      data: {
        identityId: identity.id,
        passwordHash,
      },
    });

    const session = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: 0,
      },
    };

    const ctx1 = createTestContext(session);
    const caller1 = appRouter.createCaller(ctx1);

    // Revoca tutte le sessioni
    await caller1.me.revokeAllSessions();

    invalidateTokenVersionCache(user.id);

    // Verifica tokenVersion incrementato
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(updatedUser?.tokenVersion).toBe(1);

    // Vecchio token rifiutato
    const ctx2 = createTestContext(session);
    const caller2 = appRouter.createCaller(ctx2);

    await expect(caller2.me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('JWT senza tokenVersion → UNAUTHORIZED', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test3@hardening.local',
        username: 'testuser3',
        role: 'viewer',
        isActive: true,
        tokenVersion: 0,
      },
    });

    // Session SENZA tokenVersion (simula JWT vecchio)
    const session = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: undefined, // MANCA tokenVersion
      },
    };

    const ctx = createTestContext(session);
    const caller = appRouter.createCaller(ctx);

    // Deve rifiutare
    await expect(caller.me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('Token scaduto (exp manomesso) → UNAUTHORIZED', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test4@hardening.local',
        username: 'testuser4',
        role: 'viewer',
        isActive: true,
        tokenVersion: 0,
      },
    });

    // Genera token con exp passato (-1h)
    const expiredToken = signJWT(
      {
        userId: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: 0,
      },
      { expiresIn: '-1h' }
    ); // Token già scaduto

    // Verifica che verifyJWT rifiuti (test indiretto)
    const { verifyJWT } = await import('../src/lib/jwt');
    const payload = verifyJWT(expiredToken);
    expect(payload).toBeNull(); // Token scaduto non validato
  });

  it('Utente isActive=false → UNAUTHORIZED', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test5@hardening.local',
        username: 'testuser5',
        role: 'viewer',
        isActive: false, // Utente disabilitato
        tokenVersion: 0,
      },
    });

    const session = {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tokenVersion: 0,
      },
    };

    const ctx = createTestContext(session);
    const caller = appRouter.createCaller(ctx);

    // Deve rifiutare utente disabilitato
    await expect(caller.me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
