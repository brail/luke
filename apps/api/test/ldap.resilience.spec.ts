/**
 * LDAP client resilience: retry, circuit breaker, error mapping.
 *
 * The previous version mocked **`ldapjs`** with a callback API, but the client
 * moved to **`ldapts`** (promise API): the mocks pointed at a library no longer
 * used and no test called `connect()`, so every operation died on
 * "LDAP client not connected" without ever exercising the resilience logic.
 *
 * No database access: this is a unit suite, not an integration one.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ResilientLdapClient, resetLdapBreakers } from '../src/lib/ldapClient';

import { createSilentLogger } from './helpers/logger';

const { mockClient, MockResultCodeError, MockInvalidCredentialsError, ClientConstructor } =
  vi.hoisted(() => {
    /** ldapts's base class for errors carrying an LDAP result code. */
    class MockResultCodeError extends Error {
      constructor(public code: number, message: string) {
        super(message);
      }
    }

    class MockInvalidCredentialsError extends MockResultCodeError {
      constructor() {
        super(49, 'Invalid credentials');
        this.name = 'InvalidCredentialsError';
      }
    }

    const mockClient = {
      bind: vi.fn(),
      search: vi.fn(),
      unbind: vi.fn(),
    };

    // `function`, not arrow: it's invoked with `new` and arrows aren't
    // constructible. Always returns the same instance, so tests can
    // configure its behavior before calling connect().
    const ClientConstructor = vi.fn(function () {
      return mockClient;
    });

    return { mockClient, MockResultCodeError, MockInvalidCredentialsError, ClientConstructor };
  });

vi.mock('ldapts', () => ({
  Client: ClientConstructor,
  InvalidCredentialsError: MockInvalidCredentialsError,
  ResultCodeError: MockResultCodeError,
}));

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

/** Minimal backoff: real delays would make the suite slow without adding value. */
const resilienceConfig = {
  timeoutMs: 3000,
  maxRetries: 2,
  baseDelayMs: 1,
  breakerFailureThreshold: 3,
  breakerCooldownMs: 50,
  halfOpenMaxAttempts: 1,
};

// `as any`: ResilientLdapClient types the logger as pino's `Logger`, which has
// `msgPrefix`; the helper produces a `FastifyBaseLogger`. The methods used are
// the same, the difference is only nominal.
const silentLogger = createSilentLogger() as any;

async function connectedClient(
  config: Partial<typeof resilienceConfig> = {}
): Promise<ResilientLdapClient> {
  const client = new ResilientLdapClient(
    ldapConfig,
    { ...resilienceConfig, ...config },
    silentLogger
  );
  await client.connect();
  return client;
}

describe('LDAP Resilience', () => {
  beforeEach(() => {
    // The breaker is per directory URL for the whole process, and every test here uses one URL.
    resetLdapBreakers();
    vi.clearAllMocks();
    mockClient.bind.mockReset();
    mockClient.search.mockReset();
    mockClient.unbind.mockResolvedValue(undefined);
  });

  describe('connect', () => {
    it('propaga i timeout configurati al client ldapts', async () => {
      await connectedClient();

      // The timeout isn't implemented in the wrapper: it's delegated to the library via
      // the constructor. Verifying that the values arrive is the only sensible
      // assertion without opening a real socket.
      expect(ClientConstructor).toHaveBeenCalledWith({
        url: 'ldap://test.com',
        timeout: 3000,
        connectTimeout: 3000,
      });
    });
  });

  describe('error mapping', () => {
    it('maps invalid credentials to UNAUTHORIZED without retrying', async () => {
      const client = await connectedClient();
      mockClient.bind.mockRejectedValue(new MockInvalidCredentialsError());

      const error = await client.bind('cn=user', 'wrong').catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('UNAUTHORIZED');

      // A wrong password is not a transient failure. Retrying would hit
      // Active Directory three times per typo, pushing the account closer
      // to lockout: `isNonRetryableError` must also recognize the TRPCError
      // into which `bind()` has already translated the library error.
      expect(mockClient.bind).toHaveBeenCalledTimes(1);
    });

    it('maps network errors to SERVICE_UNAVAILABLE after the retries', async () => {
      const client = await connectedClient();
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      // Initial attempt + maxRetries
      expect(mockClient.bind).toHaveBeenCalledTimes(
        resilienceConfig.maxRetries + 1
      );
    });

    it('maps network errors in search to SERVICE_UNAVAILABLE', async () => {
      const client = await connectedClient();
      mockClient.search.mockRejectedValue(new Error('ETIMEDOUT'));

      const error = await client.search('dc=test', {}).catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('returns the entries when the search succeeds', async () => {
      const client = await connectedClient();
      mockClient.search.mockResolvedValue({
        searchEntries: [{ dn: 'uid=alice,dc=test' }],
      });

      const entries = await client.search('dc=test', {});

      expect(entries).toEqual([{ dn: 'uid=alice,dc=test' }]);
    });
  });

  describe('retry', () => {
    it('succeeds without error if a later attempt goes through', async () => {
      const client = await connectedClient();
      mockClient.bind
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
        .mockResolvedValueOnce(undefined);

      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();
      expect(mockClient.bind).toHaveBeenCalledTimes(2);
    });
  });

  describe('circuit breaker', () => {
    it('opens after the failure threshold and rejects without contacting LDAP', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await client.bind('cn=user', 'secret').catch(() => {});
      }

      const callsBeforeOpen = mockClient.bind.mock.calls.length;
      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(error.message).toBe('LDAP service temporarily unavailable');
      // The whole point of the breaker: with an open circuit, the server isn't touched.
      expect(mockClient.bind).toHaveBeenCalledTimes(callsBeforeOpen);
    });

    it('moves to half-open after the cooldown and closes again if the operation succeeds', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await client.bind('cn=user', 'secret').catch(() => {});
      }

      // Cooldown expired → the breaker grants a trial attempt
      await new Promise(r =>
        setTimeout(r, resilienceConfig.breakerCooldownMs + 20)
      );

      mockClient.bind.mockReset();
      mockClient.bind.mockResolvedValue(undefined);

      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();

      // Closed again: subsequent calls go through without being rejected
      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();
      expect(mockClient.bind).toHaveBeenCalledTimes(2);
    });

    it('is shared by every client of the same directory, as one login after another', async () => {
      // `authenticateViaLdap` builds a new client per login: a per-client breaker never opened.
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        const login = await connectedClient({ maxRetries: 0 });
        await login.bind('cn=user', 'secret').catch(() => {});
      }

      const callsBeforeOpen = mockClient.bind.mock.calls.length;
      const next = await connectedClient({ maxRetries: 0 });
      const error = await next.bind('cn=user', 'secret').catch(e => e);

      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(mockClient.bind).toHaveBeenCalledTimes(callsBeforeOpen);
    });

    it('wrong passwords never open it: the directory answered', async () => {
      mockClient.bind.mockRejectedValue(new MockInvalidCredentialsError());
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold * 3; i++) {
        const login = await connectedClient({ maxRetries: 0 });
        await expect(login.bind('cn=user', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      }

      expect(mockClient.bind).toHaveBeenCalledTimes(resilienceConfig.breakerFailureThreshold * 3);
    });

    it('other directory results keep it closed too (no such object)', async () => {
      mockClient.bind.mockRejectedValue(new MockResultCodeError(32, 'No such object'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold * 2; i++) {
        const login = await connectedClient({ maxRetries: 0 });
        await login.bind('cn=user', 'secret').catch(() => {});
      }

      expect(mockClient.bind).toHaveBeenCalledTimes(resilienceConfig.breakerFailureThreshold * 2);
    });

    it('a busy directory counts as unavailable and opens it', async () => {
      mockClient.bind.mockRejectedValue(new MockResultCodeError(51, 'Busy'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        const login = await connectedClient({ maxRetries: 0 });
        await login.bind('cn=user', 'secret').catch(() => {});
      }

      const next = await connectedClient({ maxRetries: 0 });
      await expect(next.bind('cn=user', 'secret')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    });

    it('an error raised locally neither opens it nor resets the count', async () => {
      const login = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold - 1; i++) {
        await login.bind('cn=user', 'secret').catch(() => {});
      }
      // ldapts's filter parser throws a plain Error before anything is sent.
      mockClient.search.mockRejectedValue(new Error('Unbalanced parens in filter string: (uid='));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await login.search('dc=test', { filter: '(uid=' }).catch(() => {});
      }
      await login.bind('cn=user', 'secret').catch(() => {});

      await expect(login.bind('cn=user', 'secret')).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'LDAP service temporarily unavailable',
      });
    });

    it('a directory answer in half-open closes it: a wrong password proves the directory is back', async () => {
      const login = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await login.bind('cn=user', 'secret').catch(() => {});
      }
      await new Promise(r => setTimeout(r, resilienceConfig.breakerCooldownMs + 20));

      mockClient.bind.mockRejectedValueOnce(new MockInvalidCredentialsError());
      await expect(login.bind('cn=user', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

      // Closed now, so one more network failure only starts a new count: the next call still
      // reaches the directory. Had the answer left it half-open, that failure would reopen it.
      await login.bind('cn=user', 'secret').catch(() => {});
      const calls = mockClient.bind.mock.calls.length;
      await login.bind('cn=user', 'secret').catch(() => {});
      expect(mockClient.bind).toHaveBeenCalledTimes(calls + 1);
    });

    it('is kept per directory URL', async () => {
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        const login = await connectedClient({ maxRetries: 0 });
        await login.bind('cn=user', 'secret').catch(() => {});
      }

      mockClient.bind.mockReset();
      mockClient.bind.mockResolvedValue(undefined);
      const other = new ResilientLdapClient(
        { ...ldapConfig, url: 'ldap://other.test.com' },
        { ...resilienceConfig, maxRetries: 0 },
        silentLogger,
      );
      await other.connect();

      await expect(other.bind('cn=user', 'secret')).resolves.toBeUndefined();
    });

    it('failing again in half-open reopens the circuit', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await client.bind('cn=user', 'secret').catch(() => {});
      }

      await new Promise(r =>
        setTimeout(r, resilienceConfig.breakerCooldownMs + 20)
      );

      // The trial attempt fails → immediately goes back to OPEN
      await client.bind('cn=user', 'secret').catch(() => {});

      const callsAfterProbe = mockClient.bind.mock.calls.length;
      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(mockClient.bind).toHaveBeenCalledTimes(callsAfterProbe);
    });
  });

  describe('robustezza', () => {
    it('rejects the promise instead of letting an unhandled error escape', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('boom inatteso'));

      // A synchronous throw or an uncaught rejection would crash the
      // Fastify process: every error path must remain a rejection.
      await expect(client.bind('cn=user', 'secret')).rejects.toBeInstanceOf(
        Error
      );
    });
  });
});
