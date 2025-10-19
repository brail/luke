/**
 * Test di Integrazione per AuditLog
 * Verifica end-to-end che ogni azione sensibile produca entry coerenti
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  setupTestDb,
  teardownTestDb,
  createTestUser,
  createTestContext,
  createCallerAs,
} from './helpers';
import { appRouter } from '../src/routers';

describe('AuditLog Integration', () => {
  let testPrisma: PrismaClient;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  describe('USER_CREATE', () => {
    it('dovrebbe loggare entry coerente per creazione utente', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      const newUser = await caller.users.create({
        username: 'testuser',
        email: 'test@test.com',
        password: 'SecurePassword123!',
        role: 'viewer',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'USER_CREATE', targetId: newUser.id },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'USER_CREATE',
        targetType: 'User',
        targetId: newUser.id,
        actorId: admin.id,
        result: 'SUCCESS',
      });

      expect(log.traceId).toBeTruthy();
      expect(log.ip).toBe('127.0.0.1');
      expect(log.createdAt).toBeInstanceOf(Date);

      // Verifica che non ci siano password in metadata
      const metadataStr = JSON.stringify(log.metadata);
      expect(metadataStr).not.toContain('password');
      expect(metadataStr).not.toContain('SecurePass');
    });
  });

  describe('USER_UPDATE', () => {
    it('dovrebbe loggare entry per aggiornamento utente', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const { user: targetUser } = await createTestUser('viewer');

      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.users.update({
        id: targetUser.id,
        firstName: 'Updated',
        lastName: 'Name',
        role: 'editor',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'USER_UPDATE', targetId: targetUser.id },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'USER_UPDATE',
        targetType: 'User',
        targetId: targetUser.id,
        actorId: admin.id,
        result: 'SUCCESS',
      });
    });
  });

  describe('USER_DELETE (soft delete)', () => {
    it('dovrebbe loggare entry per soft delete', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const { user: targetUser } = await createTestUser('viewer');

      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.users.softDelete({ id: targetUser.id });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'USER_DELETE', targetId: targetUser.id },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'USER_DELETE',
        targetType: 'User',
        targetId: targetUser.id,
        actorId: admin.id,
        result: 'SUCCESS',
      });
    });
  });

  describe('USER_HARD_DELETE', () => {
    it('dovrebbe loggare entry per hard delete', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const { user: targetUser } = await createTestUser('viewer');

      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.users.hardDelete({ id: targetUser.id });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'USER_HARD_DELETE' },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'USER_HARD_DELETE',
        targetType: 'User',
        targetId: null, // Il middleware non può estrarre l'ID dall'input
        actorId: admin.id,
        result: 'SUCCESS',
      });
    });
  });

  describe('USER_PASSWORD_CHANGE', () => {
    it('dovrebbe loggare entry per cambio password senza password in chiaro', async () => {
      const { user: user, session } = await createTestUser('viewer');

      // Crea credenziale locale per l'utente (l'identità esiste già)
      const identity = await testPrisma.identity.findFirst({
        where: { userId: user.id, provider: 'LOCAL' },
      });

      if (identity) {
        // Crea hash valido per la password 'oldpass'
        const argon2 = await import('argon2');
        const passwordHash = await argon2.hash('oldpass');

        await testPrisma.localCredential.create({
          data: {
            identityId: identity.id,
            passwordHash: passwordHash,
          },
        });
      }

      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.me.changePassword({
        currentPassword: 'oldpass',
        newPassword: 'NewSecurePass123!',
        confirmNewPassword: 'NewSecurePass123!',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'USER_PASSWORD_CHANGE', targetId: user.id },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'USER_PASSWORD_CHANGE',
        targetType: 'User',
        targetId: user.id,
        actorId: user.id,
        result: 'SUCCESS',
      });

      // Verifica che non ci siano password in metadata
      const metadataStr = JSON.stringify(log.metadata);
      expect(metadataStr).not.toContain('password');
      expect(metadataStr).not.toContain('NewSecurePass');
    });
  });

  describe('AUTH_LOGIN', () => {
    it('dovrebbe loggare entry per login riuscito', async () => {
      const { user } = await createTestUser('viewer');

      // Crea credenziale locale per l'utente (l'identità esiste già)
      const identity = await testPrisma.identity.findFirst({
        where: { userId: user.id, provider: 'LOCAL' },
      });

      if (identity) {
        // Crea hash valido per la password 'testpass'
        const argon2 = await import('argon2');
        const passwordHash = await argon2.hash('testpass');

        await testPrisma.localCredential.create({
          data: {
            identityId: identity.id,
            passwordHash: passwordHash,
          },
        });
      }

      const caller = createCallerAs(null); // Non autenticato

      // Simula login con password corretta
      await caller.auth.login({
        username: user.username,
        password: 'testpass',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'AUTH_LOGIN' },
      });

      expect(auditLogs.length).toBeGreaterThan(0);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'AUTH_LOGIN',
        targetType: 'Auth',
        targetId: user.id,
        actorId: null, // Login non ha sessione attiva
        result: 'SUCCESS',
      });

      expect(log.traceId).toBeTruthy();
      expect(log.ip).toBe('127.0.0.1');
    });
  });

  describe('CONFIG_UPSERT', () => {
    it('dovrebbe loggare entry per configurazione con redazione segreti', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.config.set({
        key: 'app.test.secret',
        value: 'super-secret-value',
        encrypt: true,
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'CONFIG_UPSERT' },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'CONFIG_UPSERT',
        targetType: 'Config',
        actorId: admin.id,
        result: 'SUCCESS',
      });

      // Verifica redazione segreti
      const metadataStr = JSON.stringify(log.metadata);
      expect(metadataStr).toContain('app.test.secret');
      expect(metadataStr).toContain('[REDACTED]'); // Valore redatto
      expect(metadataStr).not.toContain('super-secret-value');
    });
  });

  describe('Ordering e timestamp', () => {
    it('dovrebbe ordinare per createdAt DESC', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      // Crea 3 azioni sequenziali
      const user1 = await caller.users.create({
        username: 'user1',
        email: 'user1@test.com',
        password: 'SecurePassword123!',
        role: 'viewer',
      });

      const user2 = await caller.users.create({
        username: 'user2',
        email: 'user2@test.com',
        password: 'SecurePassword123!',
        role: 'viewer',
      });

      await caller.users.softDelete({ id: user1.id });

      // Verifica ordinamento
      const auditLogs = await testPrisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      expect(auditLogs).toHaveLength(3);

      // Verifica che siano ordinati per data decrescente
      for (let i = 0; i < auditLogs.length - 1; i++) {
        expect(auditLogs[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          auditLogs[i + 1].createdAt.getTime()
        );
      }
    });
  });

  describe('Metadata redaction', () => {
    it('dovrebbe redattare campi sensibili nei metadata', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      // Crea utente con dati sensibili
      await caller.users.create({
        username: 'sensitiveuser',
        email: 'sensitive@test.com',
        password: 'SuperSecurePassword123!',
        role: 'viewer',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'USER_CREATE' },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      // Verifica che i metadata contengano informazioni utili ma non password
      expect(log.metadata).toBeTruthy();
      expect(log.metadata).toHaveProperty('input_username');
      expect(log.metadata).toHaveProperty('input_email');
      expect(log.metadata).toHaveProperty('input_role');

      // Verifica che non ci siano password in metadata
      const metadataStr = JSON.stringify(log.metadata);
      expect(metadataStr).not.toContain('password');
      expect(metadataStr).not.toContain('SecurePass');
    });
  });

  describe('USER_HARD_DELETE con targetId corretto', () => {
    it('dovrebbe loggare targetId corretto per hard delete', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const { user: targetUser } = await createTestUser('viewer');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.users.hardDelete({ id: targetUser.id });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: {
          action: 'USER_HARD_DELETE',
          targetId: targetUser.id, // Ora deve essere popolato!
        },
      });

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]).toMatchObject({
        action: 'USER_HARD_DELETE',
        targetType: 'User',
        targetId: targetUser.id,
        result: 'SUCCESS',
      });
    });
  });

  describe('CONFIG_VIEW_VALUE con targetId', () => {
    it('dovrebbe loggare targetId per visualizzazione valore raw', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      // Prima crea una config
      await caller.config.set({
        key: 'app.test.secret',
        value: 'secret123',
        encrypt: true,
      });

      // Poi visualizzala in modalità raw
      await caller.config.viewValue({
        key: 'app.test.secret',
        mode: 'raw',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: {
          action: 'CONFIG_VIEW_VALUE',
          targetId: 'app.test.secret',
        },
      });

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].targetId).toBe('app.test.secret');
    });
  });

  describe('CONFIG_UPSERT per LDAP', () => {
    it('dovrebbe loggare evento aggregato per salvataggio LDAP', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await caller.integrations.auth.saveLdapConfig({
        enabled: true,
        url: 'ldaps://ldap.example.com',
        bindDN: 'cn=admin,dc=example,dc=com',
        bindPassword: 'supersecret123',
        searchBase: 'ou=users,dc=example,dc=com',
        searchFilter: '(uid={username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: '',
        strategy: 'local-first',
      });

      const auditLogs = await testPrisma.auditLog.findMany({
        where: {
          action: 'CONFIG_UPSERT',
          targetId: 'auth.ldap',
        },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log).toMatchObject({
        action: 'CONFIG_UPSERT',
        targetType: 'AppConfig',
        targetId: 'auth.ldap',
        actorId: admin.id,
        result: 'SUCCESS',
      });

      // Verifica metadata redatti
      const metadataStr = JSON.stringify(log.metadata);
      expect(metadataStr).not.toContain('supersecret123');
      expect(metadataStr).not.toContain('bindPassword');
      expect(metadataStr).toContain('configKeys');
      expect(log.metadata).toHaveProperty('ldapEnabled');
    });

    it('dovrebbe loggare FAILURE per errore LDAP', async () => {
      const { user: admin, session } = await createTestUser('admin');
      const ctx = createTestContext(session);
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.integrations.auth.saveLdapConfig({
          enabled: true,
          url: 'invalid-url',
          bindDN: '',
          bindPassword: '',
          searchBase: '',
          searchFilter: '',
          groupSearchBase: '',
          groupSearchFilter: '',
          roleMapping: '',
          strategy: 'local-first',
        })
      ).rejects.toThrow();

      const auditLogs = await testPrisma.auditLog.findMany({
        where: {
          action: 'CONFIG_UPSERT',
          targetId: 'auth.ldap',
          result: 'FAILURE',
        },
      });

      expect(auditLogs.length).toBeGreaterThan(0);
      const log = auditLogs[0];
      expect(log.result).toBe('FAILURE');
      expect(log.metadata).toHaveProperty('errorCode');
    });
  });
});
