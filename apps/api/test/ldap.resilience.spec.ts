/**
 * Resilienza del client LDAP: retry, circuit breaker, mappatura errori.
 *
 * La versione precedente mockava **`ldapjs`** con API a callback, ma il client è
 * passato a **`ldapts`** (API a promise): i mock puntavano a una libreria non più
 * usata e nessun test chiamava `connect()`, quindi ogni operazione moriva su
 * "LDAP client not connected" senza mai esercitare la logica di resilienza.
 *
 * Nessun accesso al database: questa è una suite unit, non di integrazione.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ResilientLdapClient } from '../src/lib/ldapClient';

import { createSilentLogger } from './helpers/logger';

const { mockClient, MockInvalidCredentialsError, ClientConstructor } =
  vi.hoisted(() => {
    class MockInvalidCredentialsError extends Error {
      constructor() {
        super('Invalid credentials');
        this.name = 'InvalidCredentialsError';
      }
    }

    const mockClient = {
      bind: vi.fn(),
      search: vi.fn(),
      unbind: vi.fn(),
    };

    // `function`, non arrow: viene invocata con `new` e le arrow non sono
    // costruibili. Restituisce sempre la stessa istanza, così i test possono
    // configurarne il comportamento prima di chiamare connect().
    const ClientConstructor = vi.fn(function () {
      return mockClient;
    });

    return { mockClient, MockInvalidCredentialsError, ClientConstructor };
  });

vi.mock('ldapts', () => ({
  Client: ClientConstructor,
  InvalidCredentialsError: MockInvalidCredentialsError,
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

/** Backoff minimo: i delay reali renderebbero la suite lenta senza aggiungere valore. */
const resilienceConfig = {
  timeoutMs: 3000,
  maxRetries: 2,
  baseDelayMs: 1,
  breakerFailureThreshold: 3,
  breakerCooldownMs: 50,
  halfOpenMaxAttempts: 1,
};

// `as any`: ResilientLdapClient tipizza il logger come pino `Logger`, che ha
// `msgPrefix`; l'helper produce un `FastifyBaseLogger`. I metodi usati sono
// gli stessi, la differenza è solo nominale.
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
    vi.clearAllMocks();
    mockClient.bind.mockReset();
    mockClient.search.mockReset();
    mockClient.unbind.mockResolvedValue(undefined);
  });

  describe('connect', () => {
    it('propaga i timeout configurati al client ldapts', async () => {
      await connectedClient();

      // Il timeout non è implementato nel wrapper: è delegato alla libreria via
      // costruttore. Verificare che i valori arrivino è l'unica asserzione
      // sensata senza aprire un socket reale.
      expect(ClientConstructor).toHaveBeenCalledWith({
        url: 'ldap://test.com',
        timeout: 3000,
        connectTimeout: 3000,
      });
    });
  });

  describe('mappatura errori', () => {
    it('mappa credenziali invalide a UNAUTHORIZED senza ritentare', async () => {
      const client = await connectedClient();
      mockClient.bind.mockRejectedValue(new MockInvalidCredentialsError());

      const error = await client.bind('cn=user', 'wrong').catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('UNAUTHORIZED');

      // Una password sbagliata non è un guasto transitorio. Ritentare colpirebbe
      // Active Directory tre volte per ogni typo, avvicinando il lockout
      // dell'account: `isNonRetryableError` deve riconoscere anche il TRPCError
      // in cui `bind()` ha già tradotto l'errore della libreria.
      expect(mockClient.bind).toHaveBeenCalledTimes(1);
    });

    it('mappa gli errori di rete a SERVICE_UNAVAILABLE dopo i retry', async () => {
      const client = await connectedClient();
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      // Tentativo iniziale + maxRetries
      expect(mockClient.bind).toHaveBeenCalledTimes(
        resilienceConfig.maxRetries + 1
      );
    });

    it('mappa gli errori di rete in search a SERVICE_UNAVAILABLE', async () => {
      const client = await connectedClient();
      mockClient.search.mockRejectedValue(new Error('ETIMEDOUT'));

      const error = await client.search('dc=test', {}).catch(e => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('restituisce le entry quando la search riesce', async () => {
      const client = await connectedClient();
      mockClient.search.mockResolvedValue({
        searchEntries: [{ dn: 'uid=alice,dc=test' }],
      });

      const entries = await client.search('dc=test', {});

      expect(entries).toEqual([{ dn: 'uid=alice,dc=test' }]);
    });
  });

  describe('retry', () => {
    it('riesce senza errore se un tentativo successivo va a buon fine', async () => {
      const client = await connectedClient();
      mockClient.bind
        .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
        .mockResolvedValueOnce(undefined);

      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();
      expect(mockClient.bind).toHaveBeenCalledTimes(2);
    });
  });

  describe('circuit breaker', () => {
    it('si apre dopo la soglia di fallimenti e rifiuta senza contattare LDAP', async () => {
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
      // Il punto del breaker: a circuito aperto non si tocca il server.
      expect(mockClient.bind).toHaveBeenCalledTimes(callsBeforeOpen);
    });

    it('passa a half-open dopo il cooldown e si richiude se l\'operazione riesce', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await client.bind('cn=user', 'secret').catch(() => {});
      }

      // Cooldown scaduto → il breaker concede un tentativo di prova
      await new Promise(r =>
        setTimeout(r, resilienceConfig.breakerCooldownMs + 20)
      );

      mockClient.bind.mockReset();
      mockClient.bind.mockResolvedValue(undefined);

      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();

      // Richiuso: le chiamate successive passano senza essere rifiutate
      await expect(client.bind('cn=user', 'secret')).resolves.toBeUndefined();
      expect(mockClient.bind).toHaveBeenCalledTimes(2);
    });

    it('tornando a fallire in half-open riapre il circuito', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('connect ECONNREFUSED'));

      for (let i = 0; i < resilienceConfig.breakerFailureThreshold; i++) {
        await client.bind('cn=user', 'secret').catch(() => {});
      }

      await new Promise(r =>
        setTimeout(r, resilienceConfig.breakerCooldownMs + 20)
      );

      // Il tentativo di prova fallisce → si torna OPEN immediatamente
      await client.bind('cn=user', 'secret').catch(() => {});

      const callsAfterProbe = mockClient.bind.mock.calls.length;
      const error = await client.bind('cn=user', 'secret').catch(e => e);

      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(mockClient.bind).toHaveBeenCalledTimes(callsAfterProbe);
    });
  });

  describe('robustezza', () => {
    it('rifiuta la promise invece di lasciar sfuggire un errore non gestito', async () => {
      const client = await connectedClient({ maxRetries: 0 });
      mockClient.bind.mockRejectedValue(new Error('boom inatteso'));

      // Un throw sincrono o una rejection non catturata farebbe cadere il
      // processo Fastify: ogni percorso d'errore deve restare una rejection.
      await expect(client.bind('cn=user', 'secret')).rejects.toBeInstanceOf(
        Error
      );
    });
  });
});
