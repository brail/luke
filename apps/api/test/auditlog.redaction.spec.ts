/**
 * Test Unitari per Redazione Metadata
 * Verifica che sanitizeMetadata() redatti correttamente i dati sensibili
 *
 * Esercita la funzione **di produzione**, importata da `src/lib/auditLog`. Qui
 * ne viveva una copia incollata "per test isolati": era driftata in modo
 * invertito (blacklist prima della whitelist, 24 chiavi sicure invece di 79),
 * quindi ogni test verde certificava il comportamento della copia e nulla della
 * redazione che gira davvero — su una superficie di compliance.
 */

import { describe, it, expect } from 'vitest';

import { sanitizeMetadata } from '../src/lib/auditLog';

/**
 * Restringe il risultato di `sanitizeMetadata`, che è `unknown` per costruzione:
 * la funzione può restituire un oggetto, un array o la stringa
 * `'[REDACTED:MAX_DEPTH]'`, e il tipo lo dice onestamente.
 *
 * Il controllo è a runtime e non un cast: se un giorno la funzione smettesse di
 * restituire un oggetto, un cast lascerebbe passare le asserzioni su proprietà
 * `undefined` — cioè test verdi su una redazione che non avviene più. Qui invece
 * fallisce, e dice cosa ha ricevuto.
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `Atteso un oggetto da sanitizeMetadata, ricevuto ${
        Array.isArray(value) ? 'array' : typeof value
      }`
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Legge un percorso annidato su un risultato `unknown`, restringendo a ogni
 * livello. I segmenti numerici indicizzano gli array: `'users.0.password'`.
 *
 * Evita di annidare `asRecord()` una volta per segmento, che renderebbe le
 * asserzioni illeggibili proprio dove il test è più interessante — la redazione
 * in profondità.
 */
function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (Array.isArray(acc)) {
      const index = Number(key);
      if (!Number.isInteger(index)) {
        throw new Error(`Segmento "${key}" non è un indice valido per un array`);
      }
      return acc[index];
    }
    return asRecord(acc)[key];
  }, value);
}

describe('sanitizeMetadata', () => {
  describe('Campi sensibili (blacklist)', () => {
    it('dovrebbe redattare password e varianti', () => {
      const input = {
        username: 'test',
        password: 'secret123',
        passwordHash: 'hash123',
        confirmPassword: 'secret123',
        oldPassword: 'old123',
        newPassword: 'new123',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.passwordHash).toBe('***REDACTED***');
      expect(sanitized.confirmPassword).toBe('***REDACTED***');
      expect(sanitized.oldPassword).toBe('***REDACTED***');
      expect(sanitized.newPassword).toBe('***REDACTED***');
    });

    it('dovrebbe redattare token e varianti', () => {
      const input = {
        username: 'test',
        token: 'abc123',
        accessToken: 'xyz789',
        refreshToken: 'def456',
        apiToken: 'ghi789',
        bearerToken: 'jkl012',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(sanitized.token).toBe('***REDACTED***');
      expect(sanitized.accessToken).toBe('***REDACTED***');
      expect(sanitized.refreshToken).toBe('***REDACTED***');
      expect(sanitized.apiToken).toBe('***REDACTED***');
      expect(sanitized.bearerToken).toBe('***REDACTED***');
    });

    it('dovrebbe redattare secret e varianti', () => {
      const input = {
        username: 'test',
        secret: 'secret123',
        apiSecret: 'api123',
        clientSecret: 'client123',
        jwtSecret: 'jwt123',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(sanitized.secret).toBe('***REDACTED***');
      expect(sanitized.apiSecret).toBe('***REDACTED***');
      expect(sanitized.clientSecret).toBe('***REDACTED***');
      expect(sanitized.jwtSecret).toBe('***REDACTED***');
    });

    it('dovrebbe redattare credential e varianti', () => {
      const input = {
        username: 'test',
        credentials: 'cred123',
        userCredentials: 'user123',
        ldapCredentials: 'ldap123',
        bindDN: 'cn=admin',
        bindPassword: 'bind123',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(sanitized.credentials).toBe('***REDACTED***');
      expect(sanitized.userCredentials).toBe('***REDACTED***');
      expect(sanitized.ldapCredentials).toBe('***REDACTED***');
      expect(sanitized.bindDN).toBe('***REDACTED***');
      expect(sanitized.bindPassword).toBe('***REDACTED***');
    });
  });

  describe('Campi sicuri (whitelist)', () => {
    it('dovrebbe preservare campi whitelisted', () => {
      const input = {
        username: 'testuser',
        email: 'test@test.com',
        role: 'admin',
        firstName: 'Test',
        lastName: 'User',
        locale: 'it-IT',
        timezone: 'Europe/Rome',
        isActive: true,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized).toEqual(input);
    });

    it('dovrebbe preservare i campi del diff fase/gruppo di pianificazione (cambio fase riga collezione)', () => {
      // Aggiunti per il consolidamento dell'audit log del drawer riga collezione
      // (fase/gruppo bufferizzati, committati in un'unica COLLECTION_ROW_UPDATE):
      // senza whitelist questi finivano '[REDACTED]', vanificando il metadata.
      const input = {
        oldPhaseId: 'phase-1',
        newPhaseId: 'phase-2',
        phaseChangeNote: 'Motivazione del cambio',
        oldPlanningGroupId: 'group-1',
        newPlanningGroupId: 'group-2',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized).toEqual(input);
    });
  });

  describe('Oggetti nested', () => {
    it('dovrebbe redattare ricorsivamente oggetti nested', () => {
      const input = {
        username: 'test',
        user: {
          password: 'secret123',
          email: 'test@test.com',
          profile: {
            apiKey: 'key123',
            firstName: 'Test',
            credentials: {
              token: 'abc123',
              secret: 'def456',
            },
          },
        },
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(at(sanitized, 'user.email')).toBe('test@test.com');
      expect(at(sanitized, 'user.password')).toBe('***REDACTED***');
      expect(at(sanitized, 'user.profile.firstName')).toBe('Test');
      expect(at(sanitized, 'user.profile.apiKey')).toBe('***REDACTED***');
      // credentials contiene token/secret quindi viene redatto completamente
      expect(at(sanitized, 'user.profile.credentials')).toBe('***REDACTED***');
    });

    it('dovrebbe gestire array di oggetti', () => {
      const input = {
        users: [
          { username: 'user1', password: 'pass1' },
          { username: 'user2', password: 'pass2' },
        ],
        tokens: ['token1', 'token2'],
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.users).toHaveLength(2);
      expect(at(sanitized, 'users.0.username')).toBe('user1');
      expect(at(sanitized, 'users.0.password')).toBe('***REDACTED***');
      expect(at(sanitized, 'users.1.username')).toBe('user2');
      expect(at(sanitized, 'users.1.password')).toBe('***REDACTED***');
      // tokens contiene 'token' quindi viene redatto completamente
      expect(sanitized.tokens).toBe('***REDACTED***');
    });
  });

  describe('Edge cases', () => {
    it('dovrebbe gestire valori null e undefined', () => {
      const input = {
        username: 'test',
        password: null,
        token: undefined,
        email: 'test@test.com',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(sanitized.email).toBe('test@test.com');
      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.token).toBe('***REDACTED***');
    });

    it('dovrebbe gestire stringhe vuote', () => {
      const input = {
        username: '',
        password: '',
        email: 'test@test.com',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('');
      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.email).toBe('test@test.com');
    });

    it('dovrebbe gestire numeri e booleani', () => {
      const input = {
        id: 123,
        isActive: true,
        count: 0,
        password: 'secret',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      // id, isActive, count sono ora in whitelist
      expect(sanitized.id).toBe(123);
      expect(sanitized.isActive).toBe(true);
      expect(sanitized.count).toBe(0);
      expect(sanitized.password).toBe('***REDACTED***');
    });
  });

  describe('DoS protection', () => {
    it('dovrebbe limitare la profondità di ricorsione', () => {
      // Crea oggetto con profondità > 5
      let deepObj: any = { value: 'test' };
      for (let i = 0; i < 10; i++) {
        deepObj = { nested: deepObj };
      }

      const sanitized = asRecord(sanitizeMetadata(deepObj));

      // Dovrebbe avere MAX_DEPTH da qualche parte nella struttura
      const sanitizedStr = JSON.stringify(sanitized);
      expect(sanitizedStr).toContain('[REDACTED:MAX_DEPTH]');
    });

    it('dovrebbe gestire array molto profondi', () => {
      const input = {
        deepArray: [
          {
            nested: [
              {
                deeper: [
                  {
                    deepest: [
                      {
                        value: 'test',
                        password: 'secret',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      // Dovrebbe redattare senza crashare
      expect(sanitized).toBeDefined();
      expect(typeof sanitized).toBe('object');
    });
  });

  describe('Pattern matching case-insensitive', () => {
    it('dovrebbe redattare pattern indipendentemente dal case', () => {
      const input = {
        PASSWORD: 'pass1',
        Password: 'pass2',
        password: 'pass3',
        PassWord: 'pass4',
        TOKEN: 'token1',
        Token: 'token2',
        token: 'token3',
        SECRET: 'secret1',
        Secret: 'secret2',
        secret: 'secret3',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.PASSWORD).toBe('***REDACTED***');
      expect(sanitized.Password).toBe('***REDACTED***');
      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.PassWord).toBe('***REDACTED***');
      expect(sanitized.TOKEN).toBe('***REDACTED***');
      expect(sanitized.Token).toBe('***REDACTED***');
      expect(sanitized.token).toBe('***REDACTED***');
      expect(sanitized.SECRET).toBe('***REDACTED***');
      expect(sanitized.Secret).toBe('***REDACTED***');
      expect(sanitized.secret).toBe('***REDACTED***');
    });
  });

  describe('Chiavi non whitelisted', () => {
    it('dovrebbe redattare chiavi non in whitelist', () => {
      const input = {
        username: 'test', // whitelisted
        email: 'test@test.com', // whitelisted
        unknownField: 'value1',
        customData: 'value2',
        internalId: 'value3',
        sessionData: 'value4',
      };

      const sanitized = asRecord(sanitizeMetadata(input));

      expect(sanitized.username).toBe('test');
      expect(sanitized.email).toBe('test@test.com');
      expect(sanitized.unknownField).toBe('[REDACTED]');
      expect(sanitized.customData).toBe('[REDACTED]');
      expect(sanitized.internalId).toBe('[REDACTED]');
      expect(sanitized.sessionData).toBe('[REDACTED]');
    });
  });
});
