/**
 * Test di integrazione per Session Hardening
 * Verifica tokenVersion, invalidazione sessioni, TTL
 */

import { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeAll } from 'vitest';

import { authenticateRequest, createToken } from '../src/lib/auth';
import { signJWT } from '../src/lib/jwt';
import { invalidateTokenVersionCache } from '../src/lib/trpc';

import {
  createCallerWithSession,
  createTestUser,
  setupTestDb,
  TEST_USER_PASSWORD,
} from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  // Lo schema lo garantisce `setupTestDb()` applicando le migration Prisma.
  // Qui c'erano cinque `CREATE TABLE IF NOT EXISTS` scritti a mano, reduci
  // dell'epoca SQLite (`DATETIME`, booleani `INTEGER`) su un database Postgres:
  // inerti perché le tabelle esistevano già, e con colonne che non
  // corrispondevano più al modello (`audit_logs` dichiarava `userId`,
  // `resource`, `ipAddress`, `timestamp`).
  prisma = await setupTestDb();

  // Seed config per cache TTL
  await prisma.appConfig.create({
    data: {
      key: 'security.tokenVersionCacheTTL',
      value: '60000',
      isEncrypted: false,
    },
  });
});

describe('Session Hardening — tokenVersion', () => {
  it('Login → Call OK → ChangePassword → Call UNAUTHORIZED', async () => {
    // 1. Utente LOCAL con tokenVersion=0, identità e credenziale: `me.changePassword`
    // senza credenziale locale risponde FORBIDDEN invece di UNAUTHORIZED, cioè
    // misura il ramo sbagliato. È esattamente ciò che `createTestUser` garantisce.
    const { user, session } = await createTestUser('viewer');

    // 2. Call protetta → OK. La sessione parte da tokenVersion=0, che è quello
    // che `protectedProcedure` confronta con la riga utente.
    const caller1 = createCallerWithSession(session);
    const profile1 = await caller1.me.get();
    expect(profile1.id).toBe(user.id);

    // 3. ChangePassword → tokenVersion++
    await caller1.me.changePassword({
      currentPassword: TEST_USER_PASSWORD,
      newPassword: 'NewPass456!Longer',
      confirmNewPassword: 'NewPass456!Longer',
    });

    // Invalida cache manualmente (simula propagazione)
    invalidateTokenVersionCache(user.id);

    // 4. Verifica DB: tokenVersion=1
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(updatedUser?.tokenVersion).toBe(1);

    // 5. Call protetta con VECCHIO token (session ancora a tokenVersion=0)
    await expect(createCallerWithSession(session).me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('RevokeAllSessions → Vecchio token rifiutato', async () => {
    const { user, session } = await createTestUser('viewer');

    // Revoca tutte le sessioni
    await createCallerWithSession(session).me.revokeAllSessions();

    invalidateTokenVersionCache(user.id);

    // Verifica tokenVersion incrementato
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    expect(updatedUser?.tokenVersion).toBe(1);

    // Vecchio token rifiutato
    await expect(createCallerWithSession(session).me.get()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('JWT senza tokenVersion → UNAUTHORIZED', async () => {
    const { session } = await createTestUser('viewer');

    // Session SENZA tokenVersion (simula JWT vecchio)
    const staleSession = {
      user: { ...session.user, tokenVersion: undefined },
    };

    // Deve rifiutare
    await expect(
      createCallerWithSession(staleSession).me.get()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('Token scaduto (exp manomesso) → UNAUTHORIZED', async () => {
    const { user } = await createTestUser('viewer');

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
    const { user, session } = await createTestUser('viewer');

    // La sessione resta valida: è la riga utente a diventare inattiva, ed è
    // quella che `protectedProcedure` deve rileggere.
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    // Deve rifiutare utente disabilitato
    await expect(
      createCallerWithSession(session).me.get()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('Session Hardening — revoca su tutta la superficie', () => {
  it('authenticateRequest rifiuta un token revocato (route non-tRPC)', async () => {
    const { user } = await createTestUser('viewer');
    const token = createToken({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 0,
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const reply = { clearCookie: () => {} } as any;

    // Prima della revoca il token è buono.
    await expect(authenticateRequest(req, reply, prisma)).resolves.not.toBeNull();

    // Revoca esplicita: è ciò che `users.revokeUserSessions` fa in produzione.
    await prisma.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });
    invalidateTokenVersionCache(user.id);

    // La verifica vive dentro `authenticateRequest`, non un livello più su: prima
    // stava solo nel middleware tRPC, e ogni route Fastify (upload logo, export
    // calendario, restore di backup) accettava token revocati per l'intera vita
    // del JWT — fino a 7 giorni.
    await expect(authenticateRequest(req, reply, prisma)).resolves.toBeNull();
  });

  it('authenticateRequest rifiuta un utente disattivato', async () => {
    const { user } = await createTestUser('viewer');
    const token = createToken({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 0,
    });

    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const reply = { clearCookie: () => {} } as any;

    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });
    invalidateTokenVersionCache(user.id);

    await expect(authenticateRequest(req, reply, prisma)).resolves.toBeNull();
  });
});

describe('Session Hardening — retrocessione di ruolo', () => {
  it('declassare un admin invalida i suoi token e refreshToken non ricicla il ruolo', async () => {
    // Serve un secondo admin: la procedura rifiuta di togliere il ruolo
    // all'ultimo amministratore rimasto.
    const [actingAdmin, victim] = await Promise.all([
      createTestUser('admin'),
      createTestUser('admin'),
    ]);

    const victimCaller = createCallerWithSession(victim.session);
    // Prima della retrocessione la sessione è valida.
    await expect(victimCaller.me.get()).resolves.toBeDefined();

    await createCallerWithSession(actingAdmin.session).users.update({
      id: victim.user.id,
      role: 'viewer',
    });

    // Il token vecchio porta ancora `role: "admin"`, e `requirePermission` legge
    // il ruolo dal claim. L'unica cosa che lo ferma è il bump di `tokenVersion`.
    await expect(
      createCallerWithSession(victim.session).me.get()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // E il refresh non deve poter riemettere un token admin: rifirmava a partire
    // dal claim vecchio, quindi il declassato si rinnovava l'autorità all'infinito.
    await expect(
      createCallerWithSession(victim.session).auth.refreshToken()
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const stored = await prisma.user.findUnique({
      where: { id: victim.user.id },
      select: { role: true, tokenVersion: true },
    });
    expect(stored?.role).toBe('viewer');
    expect(stored?.tokenVersion).toBe(1);
  });
});
