/**
 * Test di Integrazione per Idempotency
 * Verifica idempotency end-to-end con chiamate tRPC reali
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { idempotencyStore } from '../src/lib/idempotency';

import {
  setupTestDb,
  teardownTestDb,
  createCallerWithIdempotency,
  createCallerAs,
  expectToThrow,
} from './helpers';


describe('Idempotency Integration', () => {
  beforeEach(async () => {
    await setupTestDb();
    // Pulisci store idempotency prima di ogni test
    idempotencyStore.clear();
  });

  afterEach(async () => {
    idempotencyStore.clear();
    await teardownTestDb();
  });

  describe('users.create idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      const userData = {
        username: 'testuser',
        email: 'testuser@test.com',
        password: 'Test123!',
        role: 'viewer' as const,
      };

      // Prima chiamata: crea utente
      const result1 = await adminCaller.users.create(userData);
      expect(result1.id).toBeDefined();
      expect(result1.username).toBe('testuser');

      // Seconda chiamata: dovrebbe ritornare lo stesso risultato senza creare duplicato
      const result2 = await adminCaller.users.create(userData);
      expect(result2.id).toBe(result1.id);
      expect(result2.username).toBe(result1.username);

      // Verifica che esista solo 1 utente nel database
      const count = await adminCaller.users.list({ page: 1, limit: 100 });
      const testUsers = count.users.filter(u => u.username === 'testuser');
      expect(testUsers).toHaveLength(1);
    });

    it('dovrebbe fallire con 409 Conflict per stessa key con body diverso', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      const userData1 = {
        username: 'testuser1',
        email: 'testuser1@test.com',
        password: 'Test123!',
        role: 'viewer' as const,
      };

      const userData2 = {
        username: 'testuser2',
        email: 'testuser2@test.com',
        password: 'Test123!',
        role: 'viewer' as const,
      };

      // Prima chiamata: crea utente
      await adminCaller.users.create(userData1);

      // Seconda chiamata con body diverso → deve fallire con CONFLICT
      await expectToThrow(adminCaller.users.create(userData2), {
        code: 'CONFLICT',
      });
    });

    it('dovrebbe permettere richieste con key diverse', async () => {
      const key1 = randomUUID();
      const key2 = randomUUID();
      const adminCaller1 = createCallerWithIdempotency(key1, 'admin');
      const adminCaller2 = createCallerWithIdempotency(key2, 'admin');

      const userData1 = {
        username: 'testuser1',
        email: 'testuser1@test.com',
        password: 'Test123!',
        role: 'viewer' as const,
      };

      const userData2 = {
        username: 'testuser2',
        email: 'testuser2@test.com',
        password: 'Test123!',
        role: 'viewer' as const,
      };

      // Entrambe le chiamate dovrebbero funzionare
      const result1 = await adminCaller1.users.create(userData1);
      const result2 = await adminCaller2.users.create(userData2);

      expect(result1.id).not.toBe(result2.id);
      expect(result1.username).toBe('testuser1');
      expect(result2.username).toBe('testuser2');
    });
  });

  describe('users.update idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      // Crea utente iniziale
      const user = await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: 'Test123!',
        role: 'viewer',
      });

      const updateData = {
        id: user.id,
        firstName: 'Updated',
        lastName: 'User',
      };

      // Prima chiamata: aggiorna utente
      const result1 = await adminCaller.users.update(updateData);
      expect(result1.firstName).toBe('Updated');

      // Seconda chiamata: dovrebbe ritornare lo stesso risultato
      const result2 = await adminCaller.users.update(updateData);
      expect(result2.id).toBe(result1.id);
      expect(result2.firstName).toBe(result1.firstName);
    });
  });

  describe('config.set idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      const configData = {
        key: 'app.test',
        value: 'test-value',
        encrypt: false,
      };

      // Prima chiamata: imposta config
      const result1 = await adminCaller.config.set(configData);
      expect(result1.key).toBe('app.test');

      // Seconda chiamata: dovrebbe ritornare lo stesso risultato
      const result2 = await adminCaller.config.set(configData);
      expect(result2.key).toBe(result1.key);
      expect(result2.value).toBe(result1.value);
    });

    it('dovrebbe fallire con 409 Conflict per stessa key con body diverso', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      const configData1 = {
        key: 'app.test1',
        value: 'test-value-1',
        encrypt: false,
      };

      const configData2 = {
        key: 'app.test2',
        value: 'test-value-2',
        encrypt: false,
      };

      // Prima chiamata: imposta config
      await adminCaller.config.set(configData1);

      // Seconda chiamata con body diverso → deve fallire con CONFLICT
      await expectToThrow(adminCaller.config.set(configData2), {
        code: 'CONFLICT',
      });
    });
  });

  describe('auth.login idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const caller = createCallerWithIdempotency(idempotencyKey, null);

      // Crea utente per test login
      const adminCaller = createCallerAs('admin');
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: 'Test123!',
        role: 'viewer',
      });

      const loginData = {
        username: 'testuser',
        password: 'Test123!',
      };

      // Prima chiamata: login
      const result1 = await caller.auth.login(loginData);
      expect(result1.user).toBeDefined();
      expect(result1.token).toBeDefined();

      // Seconda chiamata: dovrebbe ritornare lo stesso risultato
      const result2 = await caller.auth.login(loginData);
      expect(result2.user.id).toBe(result1.user.id);
      expect(result2.token).toBe(result1.token);
    });
  });

  describe('me.changePassword idempotency', () => {
    it('dovrebbe ritornare stesso risultato per doppio submit con stessa key', async () => {
      const idempotencyKey = randomUUID();
      const userCaller = createCallerWithIdempotency(idempotencyKey, 'viewer');

      const passwordData = {
        currentPassword: 'Test123!',
        newPassword: 'NewPassword123!',
      };

      // Prima chiamata: cambia password
      const result1 = await userCaller.me.changePassword(passwordData);
      expect(result1.ok).toBe(true);

      // Seconda chiamata: dovrebbe ritornare lo stesso risultato
      const result2 = await userCaller.me.changePassword(passwordData);
      expect(result2.ok).toBe(result1.ok);
    });
  });

  describe('idempotency TTL expiration', () => {
    it('dovrebbe permettere nuove richieste dopo TTL scaduto', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      const userData = {
        username: 'testuser',
        email: 'testuser@test.com',
        password: 'Test123!',
        role: 'viewer' as const,
      };

      // Prima chiamata: crea utente
      const result1 = await adminCaller.users.create(userData);
      expect(result1.id).toBeDefined();

      // Simula TTL expiration (in test reale dovresti usare fake timers)
      idempotencyStore.clear();

      // Dovrebbe permettere nuova richiesta con stessa key
      const result2 = await adminCaller.users.create(userData);
      expect(result2.id).toBeDefined();
      // Nota: in questo caso creerà un nuovo utente perché il TTL è scaduto
    });
  });

  describe('idempotency statistics', () => {
    it('dovrebbe tracciare statistiche correttamente', async () => {
      const idempotencyKey = randomUUID();
      const adminCaller = createCallerWithIdempotency(idempotencyKey, 'admin');

      const initialStats = idempotencyStore.getStats();
      expect(initialStats.size).toBe(0);
      expect(initialStats.maxSize).toBe(1000);
      expect(initialStats.ttlMs).toBe(5 * 60 * 1000); // 5 minuti

      // Fai una richiesta idempotente
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: 'Test123!',
        role: 'viewer',
      });

      const stats = idempotencyStore.getStats();
      expect(stats.size).toBe(1);
    });
  });

  describe('idempotency key validation', () => {
    it('dovrebbe accettare UUID v4 validi', async () => {
      const validKeys = [
        '550e8400-e29b-41d4-a716-446655440000',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      ];

      for (const key of validKeys) {
        const adminCaller = createCallerWithIdempotency(key, 'admin');

        await adminCaller.users.create({
          username: `testuser-${key.slice(0, 8)}`,
          email: `testuser-${key.slice(0, 8)}@test.com`,
          password: 'Test123!',
          role: 'viewer',
        });
      }
    });

    it('dovrebbe rifiutare UUID non validi', async () => {
      const invalidKeys = [
        'not-a-uuid',
        '550e8400-e29b-41d4-a716', // troppo corto
        '550e8400-e29b-41d4-a716-446655440000-extra', // troppo lungo
        '550e8400-e29b-41d4-a716-44665544000g', // carattere non valido
      ];

      for (const key of invalidKeys) {
        const adminCaller = createCallerWithIdempotency(key, 'admin');

        await expectToThrow(
          adminCaller.users.create({
            username: 'testuser',
            email: 'testuser@test.com',
            password: 'Test123!',
            role: 'viewer',
          }),
          { code: 'BAD_REQUEST' }
        );
      }
    });
  });
});
