/**
 * Resilient LDAP client: timeout, retry with exponential backoff, and a circuit breaker on the
 * service-account bind.
 *
 * An error is classified by where it arises, never by its wording. For the inputs Luke sends — a
 * fixed scope, no controls, string DNs and credentials — what ldapts rejects a bind or a search
 * with is either a `ResultCodeError` (the directory answered) or a failure to get an answer. ldapts
 * can still fail locally inside a call for inputs Luke does not send (an invalid scope, a
 * paged-results control, a non-string argument); those would be read as no answer.
 */

import { TRPCError } from '@trpc/server';
import { Client, FilterParser, InvalidCredentialsError, ResultCodeError } from 'ldapts';
import pino from 'pino';

import { calcBackoffDelay, type LdapResilienceConfig } from '@luke/core';

import type { LdapConfig } from './configManager';
import type { SearchOptions, Entry } from 'ldapts';

/**
 * The directory gave no usable answer: nothing came back, or it kept answering busy/unavailable,
 * for every attempt of an operation — or the breaker refused the login before it was tried. The
 * error behind it, result code included, is the `cause`.
 */
export class LdapUnavailableError extends TRPCError {
  constructor(cause?: unknown, message = 'LDAP service unavailable') {
    super({ code: 'SERVICE_UNAVAILABLE', message, cause });
  }
}

/** LDAP result codes busy (51) and unavailable (52): the directory answered "try again". */
const TRY_AGAIN_RESULT_CODES = new Set([51, 52]);

/**
 * Whether the directory answered an operation for good: a result code other than busy/unavailable,
 * read from the ldapts error itself or from the `cause` of the tRPC error it was mapped to. A wrong
 * password is an answer, and so is "no such object". Anything else is no usable answer.
 */
export function isDirectoryAnswer(error: unknown): boolean {
  const original = error instanceof TRPCError && error.cause ? error.cause : error;
  return original instanceof ResultCodeError && !TRY_AGAIN_RESULT_CODES.has(original.code);
}

type BreakerState = 'closed' | 'open' | 'halfOpen';

/**
 * Circuit breaker on the service-account bind, the one step of a login that carries nothing about
 * the person logging in. Counting only that step is what keeps the breaker — shared by every login
 * against a directory, and visible from outside as a refused login — from being moved by what a
 * caller types. The search and the user bind are never counted, in either direction.
 *
 * closed → open after `breakerFailureThreshold` consecutive binds without a usable answer; open →
 * half-open once `breakerCooldownMs` has passed; half-open admits one probe at a time and closes
 * after `halfOpenMaxAttempts` of them succeed, or reopens on the first that fails.
 */
class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  private probeSuccesses = 0;
  /**
   * Bumped by every state transition. A bind admitted under an older epoch settles into a state it
   * was not admitted to, and is ignored: a login that started while the breaker was closed cannot
   * restart the cooldown by failing late, nor close a half-open breaker, nor free a probe slot it
   * does not hold, by succeeding late.
   */
  private epoch = 0;

  constructor(
    /** Refreshed by `breakerFor` on every login: AppConfig can change between two of them. */
    public config: LdapResilienceConfig,
    private logger: pino.Logger
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Admission and the probe reservation run before the first `await`, so two logins arriving
    // together cannot both take the probe slot.
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.config.breakerCooldownMs) throw this.refusal();
      this.moveTo('halfOpen');
    }
    const probing = this.state === 'halfOpen';
    if (probing) {
      if (this.probeInFlight) throw this.refusal();
      this.probeInFlight = true;
    }
    // Read after the open → half-open transition above: the probe belongs to the new epoch.
    const epoch = this.epoch;

    try {
      const result = await operation();
      this.settle(epoch, probing, 'answered');
      return result;
    } catch (error) {
      // A directory result (a wrong service password) proves the directory is up. An error raised
      // locally says nothing either way.
      const outcome =
        error instanceof LdapUnavailableError ? 'unavailable' : isDirectoryAnswer(error) ? 'answered' : 'local';
      this.settle(epoch, probing, outcome);
      throw error;
    }
  }

  /** A refused admission is not a failed bind: it neither counts nor restarts the cooldown. */
  private refusal(): LdapUnavailableError {
    this.logger.warn('Circuit breaker open - rejecting LDAP login');
    return new LdapUnavailableError(undefined, 'LDAP service temporarily unavailable');
  }

  private settle(epoch: number, probing: boolean, outcome: 'answered' | 'unavailable' | 'local'): void {
    if (epoch !== this.epoch) return;

    if (probing) {
      this.probeInFlight = false;
      if (outcome === 'unavailable') this.moveTo('open');
      else if (outcome === 'answered' && ++this.probeSuccesses >= this.config.halfOpenMaxAttempts) {
        this.moveTo('closed');
      }
      return;
    }

    if (outcome === 'answered') this.failures = 0;
    else if (outcome === 'unavailable' && ++this.failures >= this.config.breakerFailureThreshold) {
      this.moveTo('open');
    }
  }

  private moveTo(state: BreakerState): void {
    this.logger.info({ from: this.state, to: state }, 'LDAP circuit breaker state change');
    this.state = state;
    this.epoch++;
    this.failures = 0;
    this.probeInFlight = false;
    this.probeSuccesses = 0;
    if (state === 'open') this.openedAt = Date.now();
  }
}

/**
 * One breaker per directory URL for the whole process. `authenticateViaLdap` builds a new client
 * for every login, so a breaker owned by the client started closed every time and never opened.
 */
const breakers = new Map<string, CircuitBreaker>();

function breakerFor(url: string, config: LdapResilienceConfig, logger: pino.Logger): CircuitBreaker {
  let breaker = breakers.get(url);
  if (!breaker) {
    breaker = new CircuitBreaker(config, logger);
    breakers.set(url, breaker);
  }
  breaker.config = config;
  return breaker;
}

/** Forgets every breaker's state. Test-only. */
export function resetLdapBreakers(): void {
  breakers.clear();
}

/**
 * LDAP client with timeout and retry on every operation, and the circuit breaker on
 * `serviceBind`.
 */
export class ResilientLdapClient {
  private _client: Client | null = null;
  private breaker: CircuitBreaker;

  constructor(
    private ldapConfig: LdapConfig,
    private resilienceConfig: LdapResilienceConfig,
    private logger: pino.Logger
  ) {
    this.breaker = breakerFor(ldapConfig.url, resilienceConfig, logger);
  }

  /**
   * Initialises the underlying ldapts `Client`.
   * The TCP connection is established lazily, by the first bind or search.
   */
  async connect(): Promise<void> {
    if (this._client) {
      try {
        await this._client.unbind();
      } catch {
        // ignore
      }
    }

    this._client = new Client({
      url: this.ldapConfig.url,
      timeout: this.resilienceConfig.timeoutMs,
      connectTimeout: Math.min(this.resilienceConfig.timeoutMs, 5000),
    });
  }

  /**
   * The first bind of a login, as the service account, through the circuit breaker. The guard ends
   * with this bind: everything a login does afterwards goes through `bind` and `search`, which the
   * breaker does not see.
   *
   * @throws {LdapUnavailableError} When the breaker is open, or the bind got no usable answer.
   * @throws {TRPCError} `UNAUTHORIZED` when the directory refuses the service credentials.
   */
  async serviceBind(dn: string, password: string): Promise<void> {
    return this.breaker.execute(() => this.bind(dn, password));
  }

  /**
   * Binds to the LDAP server with the given DN and password.
   *
   * @throws {TRPCError} `UNAUTHORIZED` for invalid credentials (LDAP code 49), not retried.
   * @throws {LdapUnavailableError} When no attempt got a usable answer.
   */
  async bind(dn: string, password: string): Promise<void> {
    const client = this.connected();
    return this.withRetry(async () => {
      try {
        await client.bind(dn, password);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials', cause: error });
        }
        throw error;
      }
    });
  }

  /**
   * Performs an LDAP search under the given base DN.
   *
   * @returns Array of matching directory entries.
   * @throws {TRPCError} `BAD_REQUEST` for a filter that does not parse, before anything is sent.
   * @throws {LdapUnavailableError} When no attempt got a usable answer.
   */
  async search(base: string, options: SearchOptions): Promise<Entry[]> {
    const client = this.connected();

    // Parsed here, with the parser ldapts would use, so that a filter error is known to be local
    // and is never mistaken for the directory failing to answer.
    let filter = options.filter;
    if (typeof filter === 'string') {
      try {
        filter = FilterParser.parseString(filter);
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid LDAP search filter', cause: error });
      }
    }

    return this.withRetry(async () => (await client.search(base, { ...options, filter })).searchEntries);
  }

  /**
   * Gracefully closes the LDAP connection by sending an unbind request.
   * Errors during unbind are logged as warnings and swallowed.
   */
  async unbind(): Promise<void> {
    if (this._client) {
      try {
        await this._client.unbind();
      } catch (error) {
        this.logger.warn(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Error during LDAP unbind'
        );
      } finally {
        this._client = null;
      }
    }
  }

  /**
   * Forcefully destroys the client and closes all connections, ignoring any errors.
   */
  async destroy(): Promise<void> {
    if (this._client) {
      try {
        await this._client.unbind();
      } catch {
        // ignore
      }
      this._client = null;
    }
  }

  private connected(): Client {
    if (!this._client) throw new Error('LDAP client not connected');
    return this._client;
  }

  /**
   * Runs an operation, retrying with exponential backoff while it gets no usable answer: nothing
   * came back, or the directory said busy/unavailable. Any other answer is final and is rethrown at
   * once — a wrong password retried is another strike toward the account's lockout, and a search
   * the directory called too slow (`timeLimitExceeded`) repeated is more load on a directory that
   * has just said it is slow.
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.resilienceConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (isDirectoryAnswer(error)) throw error;
        lastError = error;

        if (attempt < this.resilienceConfig.maxRetries) {
          const delay = this.backoffDelay(attempt);
          this.logger.warn(
            {
              attempt: attempt + 1,
              maxRetries: this.resilienceConfig.maxRetries,
              delay,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'LDAP operation failed, retrying'
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new LdapUnavailableError(lastError);
  }

  /** Exponential backoff with up to 10% jitter. */
  private backoffDelay(attempt: number): number {
    const exponentialDelay = calcBackoffDelay(attempt, this.resilienceConfig.baseDelayMs, 5000);
    return exponentialDelay + Math.random() * 0.1 * exponentialDelay;
  }
}
