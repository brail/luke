/**
 * Test di Integrazione per Rate-Limit
 * Verifica rate-limiting end-to-end con chiamate tRPC reali
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  setupTestDb,
  teardownTestDb,
  createCallerWithIP,
  createCallerAs,
  expectToThrow,
} from './helpers';
import { rateLimitStore } from '../src/lib/ratelimit';

describe('Rate-Limit Integration', () => {
  beforeEach(async () => {
    await setupTestDb();
    // Pulisci store rate-limit prima di ogni test
    rateLimitStore.clear();
  });

  afterEach(async () => {
    rateLimitStore.clear();
    await teardownTestDb();
  });

  describe('auth.login rate limiting', () => {
    it('dovrebbe bloccare dopo 5 tentativi dallo stesso IP', async () => {
      const caller = createCallerWithIP('192.168.1.100', null);

      // Prime 5 richieste dovrebbero fallire per credenziali sbagliate ma non per rate-limit
      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // 6a richiesta deve fallire con TOO_MANY_REQUESTS
      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });

    it('dovrebbe permettere richieste da IP diversi', async () => {
      const caller1 = createCallerWithIP('192.168.1.100', null);
      const caller2 = createCallerWithIP('192.168.1.200', null);

      // Raggiungi limite per IP1
      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller1.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // IP1 dovrebbe essere bloccato
      await expectToThrow(
        caller1.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // IP2 dovrebbe ancora funzionare
      await expectToThrow(
        caller2.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'UNAUTHORIZED' } // Non TOO_MANY_REQUESTS
      );
    });
  });

  describe('me.changePassword rate limiting', () => {
    it('dovrebbe bloccare dopo 3 tentativi in 15min per stesso utente', async () => {
      const adminCaller = createCallerAs('admin');

      // Crea un utente per testare cambio password
      const testUser = await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: 'Test123!',
        role: 'viewer',
      });

      // Crea caller per l'utente test
      const userCaller = createCallerAs('viewer');

      // Prime 3 richieste dovrebbero fallire per password sbagliata ma non per rate-limit
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          userCaller.me.changePassword({
            currentPassword: 'WrongPassword',
            newPassword: 'NewPassword123!',
          }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // 4a richiesta deve fallire con TOO_MANY_REQUESTS
      await expectToThrow(
        userCaller.me.changePassword({
          currentPassword: 'WrongPassword',
          newPassword: 'NewPassword123!',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('users mutations rate limiting', () => {
    it('dovrebbe bloccare dopo 10 richieste create/update/delete per stesso utente', async () => {
      const adminCaller = createCallerAs('admin');

      // Prime 10 richieste create dovrebbero funzionare
      for (let i = 0; i < 10; i++) {
        await adminCaller.users.create({
          username: `testuser${i}`,
          email: `testuser${i}@test.com`,
          password: 'Test123!',
          role: 'viewer',
        });
      }

      // 11a richiesta deve fallire con TOO_MANY_REQUESTS
      await expectToThrow(
        adminCaller.users.create({
          username: 'testuser11',
          email: 'testuser11@test.com',
          password: 'Test123!',
          role: 'viewer',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('config mutations rate limiting', () => {
    it('dovrebbe bloccare dopo 20 richieste set/update per stesso utente', async () => {
      const adminCaller = createCallerAs('admin');

      // Prime 20 richieste set dovrebbero funzionare
      for (let i = 0; i < 20; i++) {
        await adminCaller.config.set({
          key: `app.test${i}`,
          value: `value${i}`,
          encrypt: false,
        });
      }

      // 21a richiesta deve fallire con TOO_MANY_REQUESTS
      await expectToThrow(
        adminCaller.config.set({
          key: 'app.test21',
          value: 'value21',
          encrypt: false,
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('rate limit window reset', () => {
    it('dovrebbe permettere nuove richieste dopo scadenza window', async () => {
      const caller = createCallerWithIP('192.168.1.100', null);

      // Raggiungi limite
      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // Dovrebbe essere bloccato
      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // Simula reset window (in test reale dovresti usare fake timers)
      rateLimitStore.clear();

      // Dovrebbe funzionare di nuovo
      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'UNAUTHORIZED' } // Non TOO_MANY_REQUESTS
      );
    });
  });

  describe('rate limit statistics', () => {
    it('dovrebbe tracciare statistiche correttamente', async () => {
      const caller = createCallerWithIP('192.168.1.100', null);

      const initialStats = rateLimitStore.getStats();
      expect(initialStats.routes).toBe(0);
      expect(initialStats.totalKeys).toBe(0);

      // Fai alcune richieste
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      const stats = rateLimitStore.getStats();
      expect(stats.routes).toBe(1); // login route
      expect(stats.totalKeys).toBe(1); // 1 IP
      expect(stats.maxSize).toBe(1000);
    });
  });
});
