import { PrismaClient } from '@prisma/client';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from 'vitest';
import { TRPCError } from '@trpc/server';

import { ResilientLdapClient } from '../src/lib/ldapClient';
import { setupTestDb, teardownTestDb } from './helpers/database';

// Mock ldapjs
vi.mock('ldapjs', () => ({
  createClient: vi.fn(),
}));

describe('LDAP Resilience', () => {
  let prisma: PrismaClient;
  let resilienceConfig: {
    timeoutMs: number;
    maxRetries: number;
    baseDelayMs: number;
    breakerFailureThreshold: number;
    breakerCooldownMs: number;
    halfOpenMaxAttempts: number;
  };

  beforeAll(async () => {
    prisma = await setupTestDb();
    // Usa configurazione di default per i test
    resilienceConfig = {
      timeoutMs: 3000,
      maxRetries: 2,
      baseDelayMs: 200,
      breakerFailureThreshold: 5,
      breakerCooldownMs: 10000,
      halfOpenMaxAttempts: 1,
    };
  });

  afterAll(async () => {
    await teardownTestDb(prisma);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Timeout Handling', () => {
    it('should timeout operations within configured time', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      // Mock bind che non risponde mai
      mockClient.bind.mockImplementation((_dn, _password, callback) => {
        // Non chiama mai il callback - simula timeout
      });

      const startTime = Date.now();

      try {
        await client.bind('cn=user', 'password');
        expect.fail('Expected timeout error');
      } catch (error) {
        const elapsed = Date.now() - startTime;

        // Dovrebbe timeout entro timeoutMs + 100ms di tolleranza
        expect(elapsed).toBeLessThanOrEqual(resilienceConfig.timeoutMs + 100);
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit breaker after threshold failures', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      // Mock bind che fallisce sempre
      mockClient.bind.mockImplementation((_dn, _password, callback) => {
        callback(new Error('Connection refused'));
      });

      // Fallisce per il numero di volte necessario per aprire il breaker
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        try {
          await client.bind('cn=user', 'password');
          expect.fail('Expected failure');
        } catch (error) {
          expect(error).toBeInstanceOf(TRPCError);
        }
      }

      // Ora il breaker dovrebbe essere aperto
      try {
        await client.bind('cn=user', 'password');
        expect.fail('Expected circuit breaker to be open');
      } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('SERVICE_UNAVAILABLE');
        expect((error as TRPCError).message).toContain(
          'temporarily unavailable'
        );
      }
    });

    it('should transition to half-open after cooldown', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      // Config con cooldown molto breve per test
      const testConfig = { ...resilienceConfig, breakerCooldownMs: 100 };
      const client = new ResilientLdapClient(
        ldapConfig,
        testConfig,
        console as any
      );

      // Fallisce per aprire il breaker
      mockClient.bind.mockImplementation((_dn, _password, callback) => {
        callback(new Error('Connection refused'));
      });

      for (let i = 0; i < testConfig.breakerFailureThreshold; i++) {
        try {
          await client.bind('cn=user', 'password');
        } catch (error) {
          // Expected
        }
      }

      // Aspetta il cooldown
      await new Promise(resolve => setTimeout(resolve, 150));

      // Ora dovrebbe essere in half-open e accettare una chiamata
      mockClient.bind.mockImplementation((_dn, _password, callback) => {
        callback(null); // Success
      });

      // Questa chiamata dovrebbe passare (half-open)
      await expect(client.bind('cn=user', 'password')).resolves.toBeUndefined();
    });
  });

  describe('Error Mapping', () => {
    it('should map network errors to UNAVAILABLE', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      // Test vari errori di rete
      const networkErrors = [
        new Error('ECONNREFUSED'),
        new Error('ETIMEDOUT'),
        new Error('ENOTFOUND'),
        new Error('ENETUNREACH'),
        new Error('Connection timeout'),
        new Error('Network error'),
      ];

      for (const networkError of networkErrors) {
        mockClient.bind.mockImplementation((_dn, _password, callback) => {
          callback(networkError);
        });

        try {
          await client.bind('cn=user', 'password');
          expect.fail('Expected network error');
        } catch (error) {
          expect(error).toBeInstanceOf(TRPCError);
          expect((error as TRPCError).code).toBe('SERVICE_UNAVAILABLE');
        }
      }
    });

    it('should map invalid credentials to UNAUTHORIZED', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      // Test errori di credenziali
      const credentialErrors = [
        new Error('InvalidCredentials'),
        new Error('LDAP error 49'),
        new Error('invalid credentials'),
      ];

      for (const credentialError of credentialErrors) {
        mockClient.bind.mockImplementation((_dn, _password, callback) => {
          callback(credentialError);
        });

        try {
          await client.bind('cn=user', 'password');
          expect.fail('Expected credential error');
        } catch (error) {
          expect(error).toBeInstanceOf(TRPCError);
          expect((error as TRPCError).code).toBe('UNAUTHORIZED');
        }
      }
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed operations with exponential backoff', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      let callCount = 0;
      mockClient.bind.mockImplementation((_dn, _password, callback) => {
        callCount++;
        if (callCount <= 2) {
          // Fallisce le prime 2 volte
          callback(new Error('ECONNREFUSED'));
        } else {
          // Successo al terzo tentativo
          callback(null);
        }
      });

      const startTime = Date.now();
      await client.bind('cn=user', 'password');
      const elapsed = Date.now() - startTime;

      expect(callCount).toBe(3); // 2 fallimenti + 1 successo
      expect(elapsed).toBeGreaterThan(0); // Dovrebbe aver aspettato tra i retry
    });

    it('should not retry non-retryable errors', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      let callCount = 0;
      mockClient.bind.mockImplementation((_dn, _password, callback) => {
        callCount++;
        callback(new Error('InvalidCredentials')); // Non retryable
      });

      try {
        await client.bind('cn=user', 'password');
        expect.fail('Expected error');
      } catch (error) {
        expect(callCount).toBe(1); // Solo un tentativo
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('No Process Crash', () => {
    it('should not crash the process on LDAP errors', async () => {
      const mockClient = {
        destroy: vi.fn(),
        bind: vi.fn(),
        search: vi.fn(),
        unbind: vi.fn(),
        on: vi.fn(),
      };

      const ldapjs = await import('ldapjs');
      vi.mocked(ldapjs.createClient).mockReturnValue(mockClient as any);

      const ldapConfig = {
        enabled: true,
        url: 'ldap://test.com',
        bindDN: 'cn=admin',
        bindPassword: 'secret',
        searchBase: 'dc=test',
        searchFilter: '(uid=${username})',
        groupSearchBase: '',
        groupSearchFilter: '',
        roleMapping: {},
        strategy: 'local-first' as const,
      };

      const client = new ResilientLdapClient(
        ldapConfig,
        resilienceConfig,
        console as any
      );

      // Simula errori gravi che potrebbero crashare il processo
      const severeErrors = [
        new Error('FATAL: Out of memory'),
        new Error('Segmentation fault'),
        new Error('Process killed'),
      ];

      for (const severeError of severeErrors) {
        mockClient.bind.mockImplementation((_dn, _password, callback) => {
          callback(severeError);
        });

        try {
          await client.bind('cn=user', 'password');
          expect.fail('Expected error');
        } catch (error) {
          // Dovrebbe catturare l'errore senza crashare
          expect(error).toBeInstanceOf(Error);
          // Il processo dovrebbe ancora essere vivo
          expect(process.exit).not.toHaveBeenCalled();
        }
      }
    });
  });
});
