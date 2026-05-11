/**
 * Tests for portafoglio-pg-query service
 *
 * Covers:
 * - Query execution with base params (seasonCode, trademarkCode)
 * - Optional filters (salespersonCode, customerCode)
 * - Result type safety (PortafoglioRow[])
 * - SQL injection prevention (param sanitization)
 * - Error handling (missing params, DB errors)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { queryPortafoglioFromPg } from '../portafoglio-pg-query';
import type { PortafoglioParams, PortafoglioRow } from '@luke/nav';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  $queryRawUnsafe: vi.fn(),
} as unknown as PrismaClient;

// ─── Test Data ────────────────────────────────────────────────────────────────

const baseParams: PortafoglioParams = {
  seasonCode: 'E26',
  trademarkCode: 'CPH',
};

const mockRow: PortafoglioRow = {
  'DocumentType': 'SALES',
  'Order No': 'SO001',
  'Order Date': new Date('2026-01-15'),
  'Customer No': 'CUST001',
  'Quantity': 100,
  'Price': 50.5,
  'Amount': 5050,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('queryPortafoglioFromPg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic query execution', () => {
    it('should execute query with base params (seasonCode, trademarkCode)', async () => {
      const mockRows = [mockRow];
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce(mockRows);

      const result = await queryPortafoglioFromPg(mockPrisma, baseParams);

      expect(result).toEqual(mockRows);
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledOnce();

      // Verify params passed to query
      const callArgs = (mockPrisma.$queryRawUnsafe as any).mock.calls[0];
      expect(callArgs[1]).toBe(baseParams.seasonCode);
      expect(callArgs[2]).toBe(baseParams.trademarkCode);
    });

    it('should return empty array when no matching rows', async () => {
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([]);

      const result = await queryPortafoglioFromPg(mockPrisma, baseParams);

      expect(result).toEqual([]);
    });

    it('should return array of PortafoglioRow with correct shape', async () => {
      const mockRows = [
        { ...mockRow },
        { ...mockRow, 'Order No': 'SO002' },
      ];
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce(mockRows);

      const result = await queryPortafoglioFromPg(mockPrisma, baseParams);

      expect(Array.isArray(result)).toBe(true);
      result.forEach(row => {
        expect(typeof row === 'object').toBe(true);
        expect(row).toHaveProperty('DocumentType');
      });
    });
  });

  describe('Optional filter parameters', () => {
    it('should include salespersonCode filter when provided', async () => {
      const paramsWithSalesperson = {
        ...baseParams,
        salespersonCode: 'AGENT123',
      };

      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([mockRow]);

      await queryPortafoglioFromPg(mockPrisma, paramsWithSalesperson);

      const callArgs = (mockPrisma.$queryRawUnsafe as any).mock.calls[0];
      const sql = callArgs[0] as string;
      // Verify SQL contains the filter logic
      expect(sql).toContain('salespersonCode');
      // Verify param passed
      expect(callArgs).toContain('AGENT123');
    });

    it('should include customerCode filter when provided', async () => {
      const paramsWithCustomer = {
        ...baseParams,
        customerCode: 'CUST999',
      };

      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([mockRow]);

      await queryPortafoglioFromPg(mockPrisma, paramsWithCustomer);

      const callArgs = (mockPrisma.$queryRawUnsafe as any).mock.calls[0];
      const sql = callArgs[0] as string;
      expect(sql).toContain('sellToCustomerNo');
      expect(callArgs).toContain('CUST999');
    });

    it('should include both filters when both provided', async () => {
      const paramsWithBoth = {
        ...baseParams,
        salespersonCode: 'AGENT123',
        customerCode: 'CUST999',
      };

      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([mockRow]);

      await queryPortafoglioFromPg(mockPrisma, paramsWithBoth);

      const callArgs = (mockPrisma.$queryRawUnsafe as any).mock.calls[0];
      expect(callArgs).toContain('AGENT123');
      expect(callArgs).toContain('CUST999');
    });

    it('should not include optional filters when not provided', async () => {
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([mockRow]);

      await queryPortafoglioFromPg(mockPrisma, baseParams);

      const callArgs = (mockPrisma.$queryRawUnsafe as any).mock.calls[0];
      // Only base params should be passed
      expect(callArgs.length).toBe(3); // sql + 2 params (season + trademark)
    });
  });

  describe('SQL Injection prevention', () => {
    it('should use parameterized queries (not string concatenation)', async () => {
      const maliciousParams = {
        seasonCode: "E26'; DROP TABLE nav_pf_sales_header; --",
        trademarkCode: "CPH",
      };

      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([]);

      await queryPortafoglioFromPg(mockPrisma, maliciousParams);

      // Verify params are passed separately, not in SQL string
      const callArgs = (mockPrisma.$queryRawUnsafe as any).mock.calls[0];
      expect(callArgs[0]).toContain('$1'); // Parameter placeholder
      expect(callArgs[1]).toBe(maliciousParams.seasonCode);
      // SQL should NOT contain the malicious payload directly
      expect(callArgs[0]).not.toContain('DROP TABLE');
    });
  });

  describe('Error handling', () => {
    it('should propagate DB errors', async () => {
      const dbError = new Error('Database connection failed');
      (mockPrisma.$queryRawUnsafe as any).mockRejectedValueOnce(dbError);

      await expect(
        queryPortafoglioFromPg(mockPrisma, baseParams)
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle empty seasonCode gracefully', async () => {
      const emptyParams: PortafoglioParams = {
        seasonCode: '',
        trademarkCode: 'CPH',
      };

      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([]);

      const result = await queryPortafoglioFromPg(mockPrisma, emptyParams);

      // Should still execute (validation is at tRPC level)
      expect(result).toEqual([]);
    });
  });

  describe('Data type handling', () => {
    it('should preserve Date objects in results', async () => {
      const rowWithDate = {
        ...mockRow,
        'Order Date': new Date('2026-01-15T10:30:00Z'),
      };
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([rowWithDate]);

      const result = await queryPortafoglioFromPg(mockPrisma, baseParams);

      expect(result[0]['Order Date']).toBeInstanceOf(Date);
    });

    it('should preserve numeric precision', async () => {
      const rowWithNumbers = {
        ...mockRow,
        'Price': 99.99,
        'Quantity': 12345.67,
      };
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([rowWithNumbers]);

      const result = await queryPortafoglioFromPg(mockPrisma, baseParams);

      expect(result[0]['Price']).toBe(99.99);
      expect(result[0]['Quantity']).toBe(12345.67);
    });

    it('should preserve null values in optional fields', async () => {
      const rowWithNull = {
        ...mockRow,
        'CustomerReference': null,
        'Notes': null,
      };
      (mockPrisma.$queryRawUnsafe as any).mockResolvedValueOnce([rowWithNull]);

      const result = await queryPortafoglioFromPg(mockPrisma, baseParams);

      expect(result[0]['CustomerReference']).toBeNull();
      expect(result[0]['Notes']).toBeNull();
    });
  });
});
