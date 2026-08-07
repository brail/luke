/**
 * Test di Integrazione per Rate-Limit
 * Verifica rate-limiting end-to-end con chiamate tRPC reali
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { rateLimitStore } from '../src/lib/ratelimit';

import {
  setupTestDb,
  createCallerWithIP,
  createCallerAs,
  createTestUser,
  expectToThrow,
  TEST_USER_PASSWORD,
} from './helpers';


describe('Rate-Limit Integration', () => {
  beforeEach(async () => {
    // Lo store rate-limit lo azzera `test/setup.ts` prima di ogni test.
    await setupTestDb();
  });

  describe('auth.login rate limiting', () => {
    it('dovrebbe bloccare dopo 5 tentativi dallo stesso IP', async () => {
      const caller = await createCallerWithIP('192.168.1.100', null);

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
      const caller1 = await createCallerWithIP('192.168.1.100', null);
      const caller2 = await createCallerWithIP('192.168.1.200', null);

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

  describe('auth.login rate limiting blocks valid credentials too (proof of enforcement)', () => {
    it('dovrebbe bloccare anche un tentativo con credenziali valide dopo aver esaurito il bucket IP', async () => {
      // Prova end-to-end che il blocco IP-based non sia solo "risposta generica indistinguibile
      // da password sbagliata" (il gap di validazione segnalato dal pentest Strix, che dall'esterno
      // non poteva verificare se il limiter scattasse davvero): un tentativo con credenziali VERE
      // deve comunque fallire con TOO_MANY_REQUESTS una volta esaurito il bucket.
      const { user } = await createTestUser('viewer');
      const caller = await createCallerWithIP('192.168.1.150', null);

      for (let i = 0; i < 5; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'not-the-real-user', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      await expectToThrow(
        caller.auth.login({ username: user.username, password: TEST_USER_PASSWORD }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('auth.login rate limiting per username (anti password-spray)', () => {
    it('dovrebbe bloccare dopo 10 tentativi sullo stesso username da IP diversi', async () => {
      // Il bucket 'login' (keyBy: 'ip') non ferma uno spray distribuito su molti IP contro
      // un solo account: ogni IP qui sotto è sotto la soglia IP (5/60s), eppure il bucket
      // 'loginByUsername' deve comunque scattare all'11° tentativo sullo stesso username.
      const targetUsername = 'spray-target-user';

      for (let i = 0; i < 10; i++) {
        const caller = await createCallerWithIP(`10.0.0.${i + 1}`, null);
        await expectToThrow(
          caller.auth.login({ username: targetUsername, password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      const caller11 = await createCallerWithIP('10.0.0.11', null);
      await expectToThrow(
        caller11.auth.login({ username: targetUsername, password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });

    it('non deve essere aggirabile cambiando maiuscole/minuscole dello username', async () => {
      const targetUsername = 'CaseSprayTarget';

      for (let i = 0; i < 10; i++) {
        const caller = await createCallerWithIP(`10.0.1.${i + 1}`, null);
        const usernameVariant =
          i % 2 === 0 ? targetUsername.toLowerCase() : targetUsername.toUpperCase();
        await expectToThrow(
          caller.auth.login({ username: usernameVariant, password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      const caller11 = await createCallerWithIP('10.0.1.11', null);
      await expectToThrow(
        caller11.auth.login({ username: targetUsername, password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });

    it('non deve bloccare username diversi tra loro', async () => {
      // IP distinto per tentativo: isola la dimensione username, altrimenti il bucket
      // 'login' (keyBy: 'ip', max 5/60s) scatterebbe prima e confonderebbe il test.
      for (let i = 0; i < 10; i++) {
        const caller = await createCallerWithIP(`10.0.2.${i + 1}`, null);
        await expectToThrow(
          caller.auth.login({ username: `distinct-user-${i}`, password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }
    });
  });

  describe('me.changePassword rate limiting', () => {
    it('dovrebbe bloccare dopo 3 tentativi in 15min per stesso utente', async () => {
      const adminCaller = await createCallerAs('admin');

      // Crea un utente per testare cambio password
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer',
      });

      // Crea caller per l'utente test
      const userCaller = await createCallerAs('viewer');

      // Prime 3 richieste dovrebbero fallire per password sbagliata ma non per rate-limit
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          userCaller.me.changePassword({
            currentPassword: 'WrongPassw0rd!23',
            newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
          }),
          { code: 'UNAUTHORIZED' }
        );
      }

      // 4a richiesta deve fallire con TOO_MANY_REQUESTS
      await expectToThrow(
        userCaller.me.changePassword({
          currentPassword: 'WrongPassw0rd!23',
          newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('users mutations rate limiting', () => {
    it('dovrebbe bloccare dopo 10 richieste create/update/delete per stesso utente', async () => {
      const adminCaller = await createCallerAs('admin');

      // Prime 10 richieste create dovrebbero funzionare
      for (let i = 0; i < 10; i++) {
        await adminCaller.users.create({
          username: `testuser${i}`,
          email: `testuser${i}@test.com`,
          password: TEST_USER_PASSWORD,
          role: 'viewer',
        });
      }

      // 11a richiesta deve fallire con TOO_MANY_REQUESTS
      await expectToThrow(
        adminCaller.users.create({
          username: 'testuser11',
          email: 'testuser11@test.com',
          password: TEST_USER_PASSWORD,
          role: 'viewer',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );
    });
  });

  describe('config mutations rate limiting', () => {
    it('dovrebbe bloccare dopo 20 richieste set/update per stesso utente', async () => {
      const adminCaller = await createCallerAs('admin');

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
      const caller = await createCallerWithIP('192.168.1.100', null);

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
      const caller = await createCallerWithIP('192.168.1.100', null);

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
      // 'login' (chiave IP) + 'loginByUsername' (chiave username): authenticateUser()
      // controlla entrambi i bucket a ogni tentativo, vedi Fix RC brute-force.
      expect(stats.routes).toBe(2);
      expect(stats.totalKeys).toBe(2); // 1 IP + 1 username
      expect(stats.maxSize).toBe(1000);
    });
  });

  describe('ENV-based rate limits', () => {
    it('should apply custom limit from ENV variables', async () => {
      // Simula ENV override per login: 3 req/1min
      process.env.LUKE_RATE_LIMIT_LOGIN_MAX = '3';
      process.env.LUKE_RATE_LIMIT_LOGIN_WINDOW = '1m';

      const caller = await createCallerWithIP('192.168.1.100', null);

      // Con limite custom di 3, la 4a richiesta dovrebbe essere bloccata
      for (let i = 0; i < 3; i++) {
        await expectToThrow(
          caller.auth.login({ username: 'test', password: 'wrong' }),
          { code: 'UNAUTHORIZED' }
        );
      }

      await expectToThrow(
        caller.auth.login({ username: 'test', password: 'wrong' }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // Cleanup
      delete process.env.LUKE_RATE_LIMIT_LOGIN_MAX;
      delete process.env.LUKE_RATE_LIMIT_LOGIN_WINDOW;
    });

    it('should apply custom keyBy from ENV variables', async () => {
      // Simula ENV override per passwordChange: 2 req/5min con keyBy IP
      process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX = '2';
      process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_WINDOW = '5m';
      process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_KEY_BY = 'ip';

      // Crea un utente per testare cambio password
      const adminCaller = await createCallerAs('admin');
      await adminCaller.users.create({
        username: 'testuser',
        email: 'testuser@test.com',
        password: TEST_USER_PASSWORD,
        role: 'viewer',
      });

      // Crea caller per l'utente test
      const userCaller = await createCallerAs('viewer');

      // Con limite custom di 2, la 3a richiesta dovrebbe essere bloccata
      for (let i = 0; i < 2; i++) {
        await expectToThrow(
          userCaller.me.changePassword({
            currentPassword: 'WrongPassw0rd!23',
            newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
          }),
          { code: 'UNAUTHORIZED' }
        );
      }

      await expectToThrow(
        userCaller.me.changePassword({
          currentPassword: 'WrongPassw0rd!23',
          newPassword: 'NewPassw0rd!2345',
            confirmNewPassword: 'NewPassw0rd!2345',
        }),
        { code: 'TOO_MANY_REQUESTS' }
      );

      // Cleanup
      delete process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_MAX;
      delete process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_WINDOW;
      delete process.env.LUKE_RATE_LIMIT_PASSWORDCHANGE_KEY_BY;
    });
  });
});
