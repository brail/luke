/**
 * Test for Readiness & Fail-Fast Behavior
 * Verifies bootstrap fail-fast behavior and /readyz endpoint
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type MockedFunction,
} from 'vitest';

import { deriveSecret, validateMasterKey } from '@luke/core/server';
import { PrismaClient } from '@luke/db';

import {
  checkBootstrapDependencies,
  runReadinessChecks,
} from '../src/observability/readiness';


import { setupTestDb } from './helpers';

// Mock of LDAP configuration
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

// Mock of core functions
vi.mock('@luke/core/server', () => ({
  deriveSecret: vi.fn(),
  validateMasterKey: vi.fn(),
}));

// `process.exit` stays stubbed: a fail-fast that escaped during these tests
// would crash the vitest worker instead of failing the test.
vi.spyOn(process, 'exit').mockImplementation(() => {
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

  describe('checkBootstrapDependencies', () => {
    it('dovrebbe completare con successo quando tutte le dipendenze sono OK', async () => {
      // Mock all dependencies as OK
      (
        validateMasterKey as MockedFunction<typeof validateMasterKey>
      ).mockReturnValue(true);
      (deriveSecret as MockedFunction<typeof deriveSecret>).mockReturnValue(
        'mock-secret'
      );

      // Should not throw errors
      await expect(
        checkBootstrapDependencies(prisma, mockLogger)
      ).resolves.not.toThrow();

      // Verifies that logs were called
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Connessione database stabilita'
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Segreti JWT derivati con successo'
      );
    });

    it('dovrebbe fallire quando validateMasterKey restituisce false', async () => {
      // Mock master key not available
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
      // Mock master key OK but secret derivation fails
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
      // Mock DB disconnected
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

  describe('runReadinessChecks', () => {
    it('dovrebbe restituire allOk=true quando tutti i check passano', async () => {
      // Mock all checks as OK
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
      // Mock DB disconnected
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
      // Mock secrets fails
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
      // Mock a check that throws an unhandled exception
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
