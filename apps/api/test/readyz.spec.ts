/**
 * Test per Readiness & Fail-Fast Behavior
 * Verifica comportamento bootstrap fail-fast e endpoint /readyz
 */

import { PrismaClient } from '@prisma/client';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockedFunction,
} from 'vitest';

import { deriveSecret, validateMasterKey } from '@luke/core/server';

import {
  checkBootstrapDependencies,
  runReadinessChecks,
} from '../src/observability/readiness';


import { setupTestDb, teardownTestDb } from './helpers';

// Mock della configurazione LDAP
vi.mock('../src/lib/configManager', () => ({
  getLdapConfig: vi.fn().mockResolvedValue({
    enabled: false,
    url: '',
    bindDN: '',
    bindPassword: '',
    searchBase: '',
    searchFilter: '',
    groupSearchBase: '',
    groupSearchFilter: '',
    roleMapping: {},
  }),
}));

// Mock delle funzioni core
vi.mock('@luke/core/server', () => ({
  deriveSecret: vi.fn(),
  validateMasterKey: vi.fn(),
}));

// Mock di process.exit per testare fail-fast
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('Bootstrap Fail-Fast Behavior', () => {
  let prisma: PrismaClient;
  let mockLogger: any;

  beforeEach(async () => {
    prisma = await setupTestDb();
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  describe('checkBootstrapDependencies', () => {
    it('dovrebbe completare con successo quando tutte le dipendenze sono OK', async () => {
      // Mock tutte le dipendenze come OK
      (
        validateMasterKey as MockedFunction<typeof validateMasterKey>
      ).mockReturnValue(true);
      (deriveSecret as MockedFunction<typeof deriveSecret>).mockReturnValue(
        'mock-secret'
      );

      // Non dovrebbe lanciare errori
      await expect(
        checkBootstrapDependencies(prisma, mockLogger)
      ).resolves.not.toThrow();

      // Verifica che i log siano stati chiamati
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Connessione database stabilita'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Segreti JWT derivati con successo'
      );
    });

    it('dovrebbe fallire quando validateMasterKey restituisce false', async () => {
      // Mock master key non disponibile
      (
        validateMasterKey as MockedFunction<typeof validateMasterKey>
      ).mockReturnValue(false);

      await expect(
        checkBootstrapDependencies(prisma, mockLogger)
      ).rejects.toThrow('Master key non disponibile o invalida');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Master key non disponibile o invalida'
      );
    });

    it('dovrebbe fallire quando deriveSecret lancia errore', async () => {
      // Mock master key OK ma secret derivation fallisce
      (
        validateMasterKey as MockedFunction<typeof validateMasterKey>
      ).mockReturnValue(true);
      (deriveSecret as MockedFunction<typeof deriveSecret>).mockImplementation(
        () => {
          throw new Error('Secret derivation failed');
        }
      );

      await expect(
        checkBootstrapDependencies(prisma, mockLogger)
      ).rejects.toThrow(
        'Impossibile derivare segreti JWT: Secret derivation failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Impossibile derivare segreti JWT: Secret derivation failed'
      );
    });

    it('dovrebbe fallire quando la connessione DB fallisce', async () => {
      // Mock DB disconnesso
      const mockPrisma = {
        $connect: vi
          .fn()
          .mockRejectedValue(new Error('Database connection failed')),
      } as any;

      await expect(
        checkBootstrapDependencies(mockPrisma, mockLogger)
      ).rejects.toThrow(
        'Bootstrap dependency check failed: Database connection failed'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        { error: expect.any(Error) },
        'Errore verifica dipendenze bootstrap'
      );
    });
  });
});

describe('/readyz Endpoint Behavior', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = await setupTestDb();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  describe('runReadinessChecks', () => {
    it('dovrebbe restituire allOk=true quando tutti i check passano', async () => {
      // Mock tutti i check come OK
      (
        validateMasterKey as MockedFunction<typeof validateMasterKey>
      ).mockReturnValue(true);
      (deriveSecret as MockedFunction<typeof deriveSecret>).mockReturnValue(
        'mock-secret'
      );

      const result = await runReadinessChecks(prisma);

      expect(result.allOk).toBe(true);
      expect(result.checks.database).toBe('ok');
      expect(result.checks.secrets).toBe('ok');
      expect(result.checks.ldap).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });

    it('dovrebbe restituire allOk=false quando il database fallisce', async () => {
      // Mock DB disconnesso
      const mockPrisma = {
        $queryRaw: vi
          .fn()
          .mockRejectedValue(new Error('Database connection failed')),
      } as any;

      const result = await runReadinessChecks(mockPrisma);

      expect(result.allOk).toBe(false);
      expect(result.checks.database).toContain(
        'failed: Database connection failed'
      );
    });

    it('dovrebbe restituire allOk=false quando secrets fallisce', async () => {
      // Mock secrets fallisce
      (deriveSecret as MockedFunction<typeof deriveSecret>).mockImplementation(
        () => {
          throw new Error('Secret derivation failed');
        }
      );

      const result = await runReadinessChecks(prisma);

      expect(result.allOk).toBe(false);
      expect(result.checks.secrets).toContain(
        'failed: Secret derivation failed'
      );
    });

    it('dovrebbe gestire errori in check paralleli', async () => {
      // Mock un check che lancia un'eccezione non gestita
      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation(() => {
          throw new Error('Unexpected error');
        }),
      } as any;

      const result = await runReadinessChecks(mockPrisma);

      expect(result.allOk).toBe(false);
      expect(result.checks.database).toContain('failed: Unexpected error');
    });
  });
});

describe('Integration: Server Bootstrap Fail-Fast', () => {
  it('dovrebbe chiamare process.exit(1) quando bootstrap fallisce', async () => {
    // Mock tutte le dipendenze come fallite
    (
      validateMasterKey as MockedFunction<typeof validateMasterKey>
    ).mockReturnValue(false);

    // Simula il comportamento del server.ts
    const start = async () => {
      try {
        const prisma = new PrismaClient();
        const mockLogger = {
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn(),
        };

        await checkBootstrapDependencies(prisma, mockLogger);
      } catch (error: any) {
        console.error('Errore avvio server:', error);
        process.exit(1);
      }
    };

    // Dovrebbe chiamare process.exit(1)
    await expect(start()).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe('Integration: /readyz HTTP Response', () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    prisma = await setupTestDb();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await teardownTestDb();
  });

  it('dovrebbe restituire status 200 quando tutti i check passano', async () => {
    // Mock tutti i check come OK
    (
      validateMasterKey as MockedFunction<typeof validateMasterKey>
    ).mockReturnValue(true);
    (deriveSecret as MockedFunction<typeof deriveSecret>).mockReturnValue(
      'mock-secret'
    );

    const result = await runReadinessChecks(prisma);

    // Simula la logica dell'endpoint /readyz
    const statusCode = result.allOk ? 200 : 503;
    const response = {
      status: result.allOk ? 'ready' : 'unready',
      timestamp: result.timestamp,
      checks: result.checks,
    };

    expect(statusCode).toBe(200);
    expect(response.status).toBe('ready');
    expect(response.checks.database).toBe('ok');
    expect(response.checks.secrets).toBe('ok');
  });

  it('dovrebbe restituire status 503 quando almeno un check fallisce', async () => {
    // Mock secrets fallisce
    (deriveSecret as MockedFunction<typeof deriveSecret>).mockImplementation(
      () => {
        throw new Error('Secret derivation failed');
      }
    );

    const result = await runReadinessChecks(prisma);

    // Simula la logica dell'endpoint /readyz
    const statusCode = result.allOk ? 200 : 503;
    const response = {
      status: result.allOk ? 'ready' : 'unready',
      timestamp: result.timestamp,
      checks: result.checks,
    };

    expect(statusCode).toBe(503);
    expect(response.status).toBe('unready');
    expect(response.checks.secrets).toContain(
      'failed: Secret derivation failed'
    );
  });
});
