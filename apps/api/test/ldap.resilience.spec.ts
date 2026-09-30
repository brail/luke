/**
 * LDAP client resilience: what counts as no answer, what is retried, what the breaker counts.
 *
 * An error is classified by where it arises, never by its wording: what ldapts rejects a bind or a
 * search with is either a result code (the directory answered) or a failure to get an answer. The
 * suite used to pin a list of words looked for in the message, which let `EHOSTUNREACH`, a reset
 * connection and ldapts's own "Operation timed out" through as if nothing had happened.
 *
 * The breaker guards the service-account bind only. That bind carries nothing about the person
 * logging in, so nothing a caller types can move the breaker; the search and the user bind are
 * never counted, in either direction.
 *
 * `ldapts` is mocked except for its filter parser. No database access: this is a unit suite.
 */

import { TRPCError } from '@trpc/server';
import { FilterParser } from 'ldapts';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { LdapUnavailableError, ResilientLdapClient, resetLdapBreakers } from '../src/lib/ldapClient';

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

vi.mock('ldapts', async importOriginal => ({
  Client: ClientConstructor,
  InvalidCredentialsError: MockInvalidCredentialsError,
  ResultCodeError: MockResultCodeError,
  // The real parser: the client parses a filter itself, before anything is sent.
  FilterParser: (await importOriginal<typeof import('ldapts')>()).FilterParser,
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

/** Every case the breaker is involved in makes one attempt per operation. */
const once = { maxRetries: 0 };

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

/** The first step of a login: the service-account bind, on a client of its own. */
async function serviceBind(config: Partial<typeof resilienceConfig> = once): Promise<void> {
  return (await connectedClient(config)).serviceBind('cn=admin', 'secret');
}

/**
 * Clients connected ahead of time, so that the service binds a case starts "together" are admitted
 * in the order it calls them rather than in the order their connects happen to resolve.
 */
async function logins(count: number, config: Partial<typeof resilienceConfig> = once) {
  return Promise.all(Array.from({ length: count }, () => connectedClient(config)));
}

const bindAs = (login: ResilientLdapClient) => login.serviceBind('cn=admin', 'secret');

const unanswered = () => new Error('connect ECONNREFUSED');

/** A promise settled by the test, for a bind that is still in flight. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The breaker's clock. Moved by the test, so no case waits for a cooldown. */
let now = 0;
const pastCooldown = () => {
  now += resilienceConfig.breakerCooldownMs;
};

/** Fails the service bind up to the threshold: the breaker is open afterwards. */
async function openBreaker(config: Partial<typeof resilienceConfig> = once) {
  mockClient.bind.mockRejectedValue(unanswered());
  for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
    await serviceBind(config).catch(() => {});
  }
  mockClient.bind.mockReset();
}

const REFUSED = { code: 'SERVICE_UNAVAILABLE', message: 'LDAP service temporarily unavailable' };

describe('LDAP Resilience', () => {
  beforeEach(() => {
    // The breaker is per directory URL for the whole process, and every test here uses one URL.
    resetLdapBreakers();
    vi.clearAllMocks();
    mockClient.bind.mockReset();
    mockClient.search.mockReset();
    mockClient.unbind.mockResolvedValue(undefined);
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('passes the configured timeouts to the ldapts client', async () => {
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

  describe('no answer', () => {
    // As raised by Node's sockets and by ldapts 9 (`Connection timeout`, `Operation timed out`,
    // `Socket error…`). Most of these carry none of the words the old classifier looked for.
    it.each([
      'connect ECONNREFUSED 10.0.0.5:389',
      'connect EHOSTUNREACH 10.0.0.5:389',
      'read ECONNRESET',
      'write EPIPE',
      'getaddrinfo EAI_AGAIN dc.example.com',
      'Connection timeout',
      'BindRequest: Operation timed out',
      'Socket error. Message type: BindRequest (0x60)\nread ECONNRESET',
      'self-signed certificate',
    ])('"%s" is retried, then ends as unavailable', async message => {
      const client = await connectedClient();
      const raised = new Error(message);
      mockClient.bind.mockRejectedValue(raised);

      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error).toBeInstanceOf(LdapUnavailableError);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(error.cause).toBe(raised);
      // Initial attempt + maxRetries
      expect(mockClient.bind).toHaveBeenCalledTimes(resilienceConfig.maxRetries + 1);
    });

    it('a search left without an answer ends the same way', async () => {
      const client = await connectedClient();
      mockClient.search.mockRejectedValue(new Error('SearchRequest: Operation timed out'));

      await expect(client.search('dc=test', {})).rejects.toBeInstanceOf(LdapUnavailableError);
      expect(mockClient.search).toHaveBeenCalledTimes(resilienceConfig.maxRetries + 1);
    });

    it('a directory that stays busy (51) is unavailable, and the result code is kept as the cause', async () => {
      const client = await connectedClient();
      const busy = new MockResultCodeError(51, 'Busy');
      mockClient.bind.mockRejectedValue(busy);

      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error).toBeInstanceOf(LdapUnavailableError);
      expect(error.cause).toBe(busy);
      expect(mockClient.bind).toHaveBeenCalledTimes(resilienceConfig.maxRetries + 1);
    });

    it('succeeds if a later attempt goes through', async () => {
      const client = await connectedClient();
      mockClient.bind.mockRejectedValueOnce(unanswered()).mockResolvedValueOnce(undefined);

      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();
      expect(mockClient.bind).toHaveBeenCalledTimes(2);
    });

    it('stays a rejection whatever was raised', async () => {
      const client = await connectedClient(once);
      mockClient.bind.mockRejectedValue(new Error('unexpected boom'));

      // A synchronous throw or an uncaught rejection would crash the
      // Fastify process: every error path must remain a rejection.
      await expect(client.bind('cn=user', 'secret')).rejects.toBeInstanceOf(Error);
    });
  });

  describe('a directory answer', () => {
    it('maps invalid credentials to UNAUTHORIZED without retrying', async () => {
      const client = await connectedClient();
      mockClient.bind.mockRejectedValue(new MockInvalidCredentialsError());

      const error = await client.bind('cn=user', 'wrong').catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('UNAUTHORIZED');
      // A wrong password is not a transient failure. Retrying would hit Active Directory three
      // times per typo, pushing the account closer to lockout.
      expect(mockClient.bind).toHaveBeenCalledTimes(1);
    });

    // An answer is final. Code 3 can be transient, and is still not retried: repeating an expensive
    // search adds load to a directory that has just said it is slow.
    it.each([
      [32, 'No such object'],
      [3, 'Time limit exceeded'],
      [50, 'Insufficient access rights'],
    ])('result code %i is handed back as it is, without retrying', async (code, message) => {
      const client = await connectedClient();
      const answer = new MockResultCodeError(code, message);
      mockClient.search.mockRejectedValue(answer);

      await expect(client.search('dc=test', {})).rejects.toBe(answer);
      expect(mockClient.search).toHaveBeenCalledTimes(1);
    });
  });

  describe('search', () => {
    it('returns the entries when the search succeeds', async () => {
      const client = await connectedClient();
      mockClient.search.mockResolvedValue({
        searchEntries: [{ dn: 'uid=alice,dc=test' }],
      });

      const entries = await client.search('dc=test', {});

      expect(entries).toEqual([{ dn: 'uid=alice,dc=test' }]);
    });

    it('refuses a filter that does not parse before anything is sent', async () => {
      const client = await connectedClient();

      await expect(client.search('dc=test', { filter: '(uid=' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(mockClient.search).not.toHaveBeenCalled();
    });

    it('sends the filter it parsed, not the string', async () => {
      const client = await connectedClient();
      mockClient.search.mockResolvedValue({ searchEntries: [] });

      await client.search('dc=test', { filter: '(uid=alice)', scope: 'sub' });

      const [base, options] = mockClient.search.mock.calls[0];
      expect(base).toBe('dc=test');
      expect(options.scope).toBe('sub');
      expect(options.filter.toString()).toBe('(uid=alice)');
      expect(typeof options.filter).toBe('object');
    });

    it('leaves an omitted filter and an already parsed one as they are', async () => {
      const client = await connectedClient();
      mockClient.search.mockResolvedValue({ searchEntries: [] });
      const parsed = FilterParser.parseString('(uid=alice)');

      await client.search('dc=test', {});
      await client.search('dc=test', { filter: parsed });

      expect(mockClient.search.mock.calls[0][1].filter).toBeUndefined();
      expect(mockClient.search.mock.calls[1][1].filter).toBe(parsed);
    });
  });

  describe('circuit breaker', () => {
    it('opens after the failure threshold and refuses without contacting the directory', async () => {
      await openBreaker();

      const error = await serviceBind().catch(e => e);

      expect(error).toBeInstanceOf(LdapUnavailableError);
      expect(error).toMatchObject(REFUSED);
      // The whole point of the breaker: with an open circuit, the server isn't touched.
      expect(mockClient.bind).not.toHaveBeenCalled();
    });

    it('counts a login as one failure however many times its bind was retried', async () => {
      mockClient.bind.mockRejectedValue(unanswered());
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold - 1; i++) {
        await serviceBind({ maxRetries: 2 }).catch(() => {});
      }
      mockClient.bind.mockReset();
      mockClient.bind.mockResolvedValue(undefined);

      await expect(serviceBind()).resolves.toBeUndefined();
    });

    it('a directory that stays busy opens it', async () => {
      mockClient.bind.mockRejectedValue(new MockResultCodeError(51, 'Busy'));
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await serviceBind().catch(() => {});
      }

      await expect(serviceBind()).rejects.toMatchObject(REFUSED);
    });

    it('a refused service bind proves the directory is up and zeroes the count', async () => {
      const failuresBelowThreshold = async () => {
        mockClient.bind.mockRejectedValue(unanswered());
        for (let i = 0; i < resilienceConfig.breakerFailureThreshold - 1; i++) {
          await serviceBind().catch(() => {});
        }
      };
      await failuresBelowThreshold();
      mockClient.bind.mockRejectedValue(new MockInvalidCredentialsError());
      await expect(serviceBind()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await failuresBelowThreshold();

      // Still closed: the next bind reaches the directory.
      mockClient.bind.mockReset();
      mockClient.bind.mockResolvedValue(undefined);
      await expect(serviceBind()).resolves.toBeUndefined();
    });

    it('is kept per directory URL', async () => {
      await openBreaker();
      mockClient.bind.mockResolvedValue(undefined);
      const other = new ResilientLdapClient(
        { ...ldapConfig, url: 'ldap://other.test.com' },
        { ...resilienceConfig, ...once },
        silentLogger,
      );
      await other.connect();

      await expect(other.serviceBind('cn=admin', 'secret')).resolves.toBeUndefined();
    });

    describe('what follows the service bind never moves it', () => {
      it('a search and a user bind left without an answer do not open it', async () => {
        const login = await connectedClient(once);
        mockClient.bind.mockResolvedValueOnce(undefined);
        await login.serviceBind('cn=admin', 'secret');

        mockClient.search.mockRejectedValue(new Error('SearchRequest: Operation timed out'));
        mockClient.bind.mockRejectedValue(new Error('BindRequest: Operation timed out'));
        for (let i = 0; i < resilienceConfig.breakerFailureThreshold + 1; i++) {
          await expect(login.search('dc=test', {})).rejects.toBeInstanceOf(LdapUnavailableError);
          await expect(login.bind('uid=alice,dc=test', 'pw')).rejects.toBeInstanceOf(LdapUnavailableError);
        }

        mockClient.bind.mockReset();
        mockClient.bind.mockResolvedValue(undefined);
        await expect(serviceBind()).resolves.toBeUndefined();
      });

      it('a user bind the directory answers does not zero the count', async () => {
        mockClient.bind.mockRejectedValue(unanswered());
        for (let i = 0; i < resilienceConfig.breakerFailureThreshold - 1; i++) {
          await serviceBind().catch(() => {});
        }
        // Someone types a wrong password: an answer, on an operation the breaker does not watch.
        const login = await connectedClient(once);
        mockClient.bind.mockRejectedValueOnce(new MockInvalidCredentialsError());
        await expect(login.bind('uid=alice,dc=test', 'wrong')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

        await serviceBind().catch(() => {});

        mockClient.bind.mockReset();
        await expect(serviceBind()).rejects.toMatchObject(REFUSED);
        expect(mockClient.bind).not.toHaveBeenCalled();
      });
    });

    it('an error raised locally neither counts nor zeroes the count', async () => {
      mockClient.bind.mockRejectedValue(unanswered());
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold - 1; i++) {
        await serviceBind().catch(() => {});
      }
      // Never connected: refused before anything is sent.
      const unconnected = new ResilientLdapClient(ldapConfig, { ...resilienceConfig, ...once }, silentLogger);
      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await expect(unconnected.serviceBind('cn=admin', 'secret')).rejects.toThrow('LDAP client not connected');
      }

      await serviceBind().catch(() => {});

      await expect(serviceBind()).rejects.toMatchObject(REFUSED);
    });

    it('a refused admission neither counts as a failure nor restarts the cooldown', async () => {
      await openBreaker();
      now += resilienceConfig.breakerCooldownMs - 10;
      await expect(serviceBind()).rejects.toMatchObject(REFUSED);

      // Past the cooldown measured from the opening, not from the refusal above.
      now += 10;
      mockClient.bind.mockResolvedValue(undefined);
      await expect(serviceBind()).resolves.toBeUndefined();
    });

    describe('half-open', () => {
      it('lets one login through after the cooldown, and its success closes the breaker', async () => {
        await openBreaker();
        pastCooldown();
        mockClient.bind.mockResolvedValue(undefined);

        await expect(serviceBind()).resolves.toBeUndefined();
        await expect(serviceBind()).resolves.toBeUndefined();
        expect(mockClient.bind).toHaveBeenCalledTimes(2);
      });

      it('a refused service bind closes it too: the directory is back', async () => {
        await openBreaker();
        pastCooldown();
        mockClient.bind.mockRejectedValueOnce(new MockInvalidCredentialsError());
        await expect(serviceBind()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

        // Closed, so one more failure only starts a new count and the next bind is still tried.
        mockClient.bind.mockRejectedValue(unanswered());
        await serviceBind().catch(() => {});
        await serviceBind().catch(() => {});
        expect(mockClient.bind).toHaveBeenCalledTimes(3);
      });

      it('a probe that fails reopens it for a full cooldown', async () => {
        await openBreaker();
        pastCooldown();
        mockClient.bind.mockRejectedValue(unanswered());
        await serviceBind().catch(() => {});
        mockClient.bind.mockReset();

        now += resilienceConfig.breakerCooldownMs - 1;
        await expect(serviceBind()).rejects.toMatchObject(REFUSED);
        expect(mockClient.bind).not.toHaveBeenCalled();
      });

      it('admits one probe at a time: logins arriving with it are refused', async () => {
        await openBreaker();
        pastCooldown();
        const probe = deferred();
        mockClient.bind.mockReturnValue(probe.promise);

        const [first, second, third] = (await logins(3)).map(bindAs);
        await expect(second).rejects.toMatchObject(REFUSED);
        await expect(third).rejects.toMatchObject(REFUSED);
        expect(mockClient.bind).toHaveBeenCalledTimes(1);

        probe.resolve();
        await expect(first).resolves.toBeUndefined();
        // Closed: every login is admitted again.
        mockClient.bind.mockResolvedValue(undefined);
        await Promise.all([serviceBind(), serviceBind()]);
        expect(mockClient.bind).toHaveBeenCalledTimes(3);
      });

      it('needs `halfOpenMaxAttempts` successful probes, one after the other', async () => {
        const twice = { ...once, halfOpenMaxAttempts: 2 };
        await openBreaker(twice);
        pastCooldown();
        mockClient.bind.mockResolvedValue(undefined);
        await serviceBind(twice);

        // Still half-open with its slot free: of two logins arriving together, one is the probe.
        const held = deferred();
        mockClient.bind.mockReturnValue(held.promise);
        const [probe, turnedAway] = (await logins(2, twice)).map(bindAs);
        await expect(turnedAway).rejects.toMatchObject(REFUSED);
        held.resolve();
        await probe;

        // Closed by the second success: both of two logins are admitted.
        mockClient.bind.mockClear();
        mockClient.bind.mockResolvedValue(undefined);
        await Promise.all((await logins(2, twice)).map(bindAs));
        expect(mockClient.bind).toHaveBeenCalledTimes(2);
      });

      it('starts the count of successful probes again each time it is entered', async () => {
        const twice = { ...once, halfOpenMaxAttempts: 2 };
        await openBreaker(twice);
        pastCooldown();
        mockClient.bind.mockResolvedValueOnce(undefined).mockRejectedValueOnce(unanswered());
        await serviceBind(twice);
        await serviceBind(twice).catch(() => {});
        pastCooldown();

        // One success from the first visit must not carry over: this one is the first of two.
        mockClient.bind.mockResolvedValueOnce(undefined);
        await serviceBind(twice);
        const held = deferred();
        mockClient.bind.mockReturnValue(held.promise);
        const [probe, turnedAway] = (await logins(2, twice)).map(bindAs);
        await expect(turnedAway).rejects.toMatchObject(REFUSED);
        held.resolve();
        await probe;
      });

      it('a probe that says nothing about the directory frees the slot and changes nothing', async () => {
        await openBreaker();
        pastCooldown();
        const unconnected = new ResilientLdapClient(ldapConfig, { ...resilienceConfig, ...once }, silentLogger);
        await expect(unconnected.serviceBind('cn=admin', 'secret')).rejects.toThrow('LDAP client not connected');

        // Still half-open, slot free: one of two is admitted.
        const held = deferred();
        mockClient.bind.mockReturnValue(held.promise);
        const [probe, turnedAway] = (await logins(2)).map(bindAs);
        await expect(turnedAway).rejects.toMatchObject(REFUSED);
        held.resolve();
        await probe;
        expect(mockClient.bind).toHaveBeenCalledTimes(1);
      });
    });

    describe('a login that settles after the state has moved on', () => {
      /**
       * As many service binds as the threshold, admitted while the breaker is closed and still in
       * flight when other logins open it. One such bind would not show the fault: it takes a
       * threshold's worth of late failures to open a breaker again.
       */
      async function loginsStillInFlight() {
        const slow = deferred();
        mockClient.bind.mockReturnValue(slow.promise);
        const early = (await logins(resilienceConfig.breakerFailureThreshold)).map(bindAs);
        await openBreaker();
        return { slow, early };
      }

      it('cannot restart the cooldown by failing late', async () => {
        const { slow, early } = await loginsStillInFlight();

        now += resilienceConfig.breakerCooldownMs - 10;
        slow.reject(unanswered());
        await Promise.allSettled(early);

        // Past the cooldown measured from the opening, not from those late failures.
        now += 10;
        mockClient.bind.mockResolvedValue(undefined);
        await expect(serviceBind()).resolves.toBeUndefined();
      });

      it('cannot close a half-open breaker, nor free the probe slot, by succeeding late', async () => {
        const { slow, early } = await loginsStillInFlight();
        pastCooldown();
        const held = deferred();
        mockClient.bind.mockReturnValue(held.promise);
        const probe = bindAs(await connectedClient(once));

        slow.resolve();
        await Promise.all(early);

        await expect(serviceBind()).rejects.toMatchObject(REFUSED);
        held.resolve();
        await probe;
      });
    });
  });
});
