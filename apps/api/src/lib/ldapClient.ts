/**
 * Wrapper LDAP resiliente con circuit breaker, retry e timeout
 * Gestisce errori di rete, timeout e mappatura semantica per fallback sicuro
 */

import { TRPCError } from '@trpc/server';
import { Client, InvalidCredentialsError } from 'ldapts';
import type { SearchOptions, Entry } from 'ldapts';
import pino from 'pino';

import type { LdapConfig } from './configManager';
import type { LdapResilienceConfig } from '@luke/core';

/**
 * Stati del circuit breaker
 */
enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'halfOpen',
}

/**
 * Circuit breaker custom per LDAP
 * Gestisce state machine: closed → open → halfOpen → closed
 */
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  constructor(
    private config: LdapResilienceConfig,
    private logger: pino.Logger
  ) {}

  /**
   * Esegue operazione tramite circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenAttempts = 0;
        this.logger.info('Circuit breaker transitioning to HALF_OPEN');
      } else {
        this.logger.warn('Circuit breaker OPEN - rejecting request');
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'LDAP service temporarily unavailable',
        });
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    const now = Date.now();
    return now - this.lastFailureTime >= this.config.breakerCooldownMs;
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.state = CircuitBreakerState.CLOSED;
        this.logger.info('Circuit breaker transitioning to CLOSED');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn(
        'Circuit breaker transitioning to OPEN (half-open failure)'
      );
    } else if (this.failureCount >= this.config.breakerFailureThreshold) {
      this.state = CircuitBreakerState.OPEN;
      this.logger.warn(
        'Circuit breaker transitioning to OPEN (threshold reached)'
      );
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }
}

/**
 * Client LDAP resiliente con retry, timeout e circuit breaker
 */
export class ResilientLdapClient {
  private _client: Client | null = null;
  private breaker: CircuitBreaker;

  constructor(
    private ldapConfig: LdapConfig,
    private resilienceConfig: LdapResilienceConfig,
    private logger: pino.Logger
  ) {
    this.breaker = new CircuitBreaker(resilienceConfig, logger);
  }

  /**
   * Connette al server LDAP
   * ldapts usa connessione lazy: il Client viene creato qui,
   * la connessione TCP avviene al primo bind().
   */
  async connect(): Promise<void> {
    return this.breaker.execute(async () => {
      return this.retryWithBackoff(async () => {
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
      });
    });
  }

  /**
   * Bind con credenziali
   */
  async bind(dn: string, password: string): Promise<void> {
    return this.breaker.execute(async () => {
      return this.retryWithBackoff(async () => {
        if (!this._client) {
          throw new Error('LDAP client not connected');
        }

        try {
          await this._client.bind(dn, password);
        } catch (error) {
          // Map LDAP error code 49 (InvalidCredentials) → UNAUTHORIZED
          if (this.isInvalidCredentialsError(error)) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: 'Invalid credentials',
            });
          }
          throw error;
        }
      });
    });
  }

  /**
   * Ricerca LDAP
   */
  async search(
    base: string,
    options: SearchOptions
  ): Promise<Entry[]> {
    return this.breaker.execute(async () => {
      return this.retryWithBackoff(async () => {
        if (!this._client) {
          throw new Error('LDAP client not connected');
        }

        try {
          const { searchEntries } = await this._client.search(base, options);
          return searchEntries;
        } catch (error) {
          // Map search errors
          if (this.isNetworkError(error)) {
            throw new TRPCError({
              code: 'BAD_GATEWAY',
              message: 'LDAP search failed due to network error',
            });
          }
          if (this.isInvalidFilterError(error)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Invalid LDAP search filter',
            });
          }
          throw error;
        }
      });
    });
  }

  /**
   * Chiude connessione LDAP
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
   * Distrugge il client e chiude tutte le connessioni
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

  /**
   * Retry con exponential backoff e jitter
   */
  private async retryWithBackoff<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (
      let attempt = 0;
      attempt <= this.resilienceConfig.maxRetries;
      attempt++
    ) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        // Non retry per errori di autenticazione o validazione
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (attempt < this.resilienceConfig.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          this.logger.warn(
            {
              attempt: attempt + 1,
              maxRetries: this.resilienceConfig.maxRetries,
              delay,
              error: lastError.message,
            },
            'LDAP operation failed, retrying'
          );
          await this.sleep(delay);
        }
      }
    }

    // Map final error to appropriate TRPCError
    if (lastError) {
      if (this.isNetworkError(lastError)) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'LDAP service unavailable',
        });
      }
      throw lastError;
    }

    throw new Error('Retry exhausted without error');
  }

  /**
   * Calcola delay per exponential backoff con jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay =
      this.resilienceConfig.baseDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, 5000); // Max 5 secondi
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verifica se l'errore è di credenziali invalide (non retryable)
   */
  private isInvalidCredentialsError(error: unknown): boolean {
    return error instanceof InvalidCredentialsError;
  }

  /**
   * Verifica se l'errore è di rete (retryable)
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('enetunreach') ||
        message.includes('etimedout') ||
        message.includes('connection') ||
        message.includes('network')
      );
    }
    return false;
  }

  /**
   * Verifica se l'errore è di filtro invalido (non retryable)
   */
  private isInvalidFilterError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('invalid filter') ||
        message.includes('syntax error') ||
        message.includes('malformed')
      );
    }
    return false;
  }

  /**
   * Verifica se l'errore non è retryable
   */
  private isNonRetryableError(error: unknown): boolean {
    return (
      this.isInvalidCredentialsError(error) || this.isInvalidFilterError(error)
    );
  }
}
