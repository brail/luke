/**
 * Test Unitari per Redazione Metadata
 * Verifica che sanitizeMetadata() redatti correttamente i dati sensibili
 */

import { describe, it, expect } from 'vitest';

// Importa la funzione di redazione (dobbiamo esportarla per i test)
// Per ora testiamo la logica direttamente

/**
 * Chiavi sicure per metadata (whitelist approach)
 */
const SAFE_KEYS = new Set([
  'username',
  'email',
  'role',
  'action',
  'timestamp',
  'provider',
  'success',
  'reason',
  'key',
  'isEncrypted',
  'locale',
  'timezone',
  'firstName',
  'lastName',
  'isActive',
  'strategy',
  'userAgent',
  'createdAt',
  'updatedAt',
  'lastLoginAt',
  'loginCount',
  'id',
  'count',
]);

/**
 * Redazione ricorsiva dei metadati con whitelist + blacklist
 * Copia della funzione da auditLog.ts per test isolati
 */
function sanitizeMetadata(obj: any, depth = 0): any {
  // Limite ricorsione (DoS protection)
  if (depth > 5) return '[REDACTED:MAX_DEPTH]';

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeMetadata(item, depth + 1));
  }

  if (obj && typeof obj === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Blacklist esplicita per pattern sensibili
      if (/password|token|secret|key|auth|credential|bind/i.test(key)) {
        sanitized[key] = '***REDACTED***';
      } else if (SAFE_KEYS.has(key)) {
        sanitized[key] = sanitizeMetadata(value, depth + 1);
      } else {
        // Default: redatta chiavi non whitelisted
        if (typeof value === 'string') {
          sanitized[key] = '[REDACTED]';
        } else if (Array.isArray(value)) {
          sanitized[key] = sanitizeMetadata(value, depth + 1);
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeMetadata(value, depth + 1);
        } else {
          sanitized[key] = '[REDACTED]';
        }
      }
    }
    return sanitized;
  }

  return obj; // Primitives safe
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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

      expect(sanitized.username).toBe('test');
      expect(sanitized.user.email).toBe('test@test.com');
      expect(sanitized.user.password).toBe('***REDACTED***');
      expect(sanitized.user.profile.firstName).toBe('Test');
      expect(sanitized.user.profile.apiKey).toBe('***REDACTED***');
      // credentials contiene token/secret quindi viene redatto completamente
      expect(sanitized.user.profile.credentials).toBe('***REDACTED***');
    });

    it('dovrebbe gestire array di oggetti', () => {
      const input = {
        users: [
          { username: 'user1', password: 'pass1' },
          { username: 'user2', password: 'pass2' },
        ],
        tokens: ['token1', 'token2'],
      };

      const sanitized = sanitizeMetadata(input);

      expect(sanitized.users).toHaveLength(2);
      expect(sanitized.users[0].username).toBe('user1');
      expect(sanitized.users[0].password).toBe('***REDACTED***');
      expect(sanitized.users[1].username).toBe('user2');
      expect(sanitized.users[1].password).toBe('***REDACTED***');
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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(deepObj);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

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

      const sanitized = sanitizeMetadata(input);

      expect(sanitized.username).toBe('test');
      expect(sanitized.email).toBe('test@test.com');
      expect(sanitized.unknownField).toBe('[REDACTED]');
      expect(sanitized.customData).toBe('[REDACTED]');
      expect(sanitized.internalId).toBe('[REDACTED]');
      expect(sanitized.sessionData).toBe('[REDACTED]');
    });
  });
});
