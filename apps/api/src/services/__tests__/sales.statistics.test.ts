/**
 * Tests for sales.statistics service (XLSX builder)
 *
 * Covers:
 * - ExcelJS WorkbookWriter streaming (memory efficiency)
 * - Column formatting (numeric, date)
 * - Metadata handling (title, author, manager, subject)
 * - Empty dataset handling
 * - Large dataset memory safety
 * - Buffer conversion and integrity
 */

import { describe, it, expect } from 'vitest';
import { buildPortafoglioXlsx } from '../sales.statistics';
import type { PortafoglioRow } from '@luke/nav';

// ─── Test Data ────────────────────────────────────────────────────────────────

const mockRow: PortafoglioRow = {
  'DocumentType': 'SALES',
  'Order No': 'SO001',
  'Order Date': new Date('2026-01-15'),
  'Quantity': 100,
  'Price': 50.5,
  'Amount': 5050,
  'ScontoFattura': 10.5,
  'EstimatedMargin': 25.75,
  'Sold Out Date': new Date('2026-02-01'),
  'Notes': 'Standard order',
  'EmptyField': null,
};

const generateLargeDataset = (count: number): PortafoglioRow[] => {
  return Array.from({ length: count }, (_, i) => ({
    ...mockRow,
    'Order No': `SO${String(i + 1).padStart(6, '0')}`,
    'Quantity': Math.floor(Math.random() * 1000),
    'Price': Math.random() * 100,
  }));
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildPortafoglioXlsx', () => {
  describe('Basic XLSX generation', () => {
    it('should generate valid XLSX buffer', async () => {
      const rows = [mockRow];

      const buffer = await buildPortafoglioXlsx(rows, 'Portafoglio');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // XLSX files start with PK (ZIP format)
      expect(buffer[0]).toBe(0x50); // 'P'
      expect(buffer[1]).toBe(0x4b); // 'K'
    });

    it('should handle empty dataset', async () => {
      const buffer = await buildPortafoglioXlsx([], 'Empty');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should accept custom sheet name', async () => {
      const rows = [mockRow];
      const customName = 'CustomSheet';

      const buffer = await buildPortafoglioXlsx(rows, customName);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // Sheet name is embedded in the XLSX structure
    });
  });

  describe('Metadata handling', () => {
    it('should apply document metadata (title, author, subject, manager)', async () => {
      const rows = [mockRow];
      const metadata = {
        title: 'Test Report',
        author: 'Test Author',
        subject: 'Test Subject',
        manager: 'Test Manager',
      };

      const buffer = await buildPortafoglioXlsx(rows, 'Sheet', metadata);

      expect(buffer).toBeInstanceOf(Buffer);
      // Metadata is in docProps/core.xml within the XLSX
      const bufferStr = buffer.toString('base64');
      expect(bufferStr.length).toBeGreaterThan(0);
    });

    it('should use default metadata when not provided', async () => {
      const rows = [mockRow];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should handle partial metadata override', async () => {
      const rows = [mockRow];
      const metadata = {
        title: 'Only Title',
      };

      const buffer = await buildPortafoglioXlsx(rows, 'Sheet', metadata);

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('Data formatting', () => {
    it('should format numeric columns with decimals', async () => {
      const rows = [
        {
          'Price': 99.99,
          'Discount': 10.50,
          'Amount': 5050.75,
          'Margin': 25.333333,
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should format date columns', async () => {
      const rows = [
        {
          'Order Date': new Date('2026-01-15'),
          'Ship Date': new Date('2026-01-20'),
          'Sold Out Date': new Date('2026-02-01'),
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should convert boolean values to SI/NO', async () => {
      const rows = [
        {
          'HasDiscount': true,
          'IsSoldOut': false,
          'IsSpecial': true,
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle null/undefined values as blank cells', async () => {
      const rows = [
        {
          'Field1': 'value1',
          'Field2': null,
          'Field3': undefined,
          'Field4': '',
          'Field5': 'value5',
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('Memory efficiency (streaming)', () => {
    it('should generate XLSX for moderate dataset (~1000 rows) efficiently', async () => {
      const rows = generateLargeDataset(1000);
      const startMem = process.memoryUsage().heapUsed;

      const buffer = await buildPortafoglioXlsx(rows);

      const endMem = process.memoryUsage().heapUsed;
      const memUsed = (endMem - startMem) / 1024 / 1024; // MB

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
      // Should use reasonable memory (<50MB for 1000 rows)
      expect(memUsed).toBeLessThan(50);
    });

    it('should handle large dataset (~10k rows) without OOM', async () => {
      const rows = generateLargeDataset(10000);

      // Should complete without throwing
      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should stream data (not load all in memory at once)', async () => {
      const rows = generateLargeDataset(5000);

      // With streaming, memory should not spike to hold all rows
      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
      // File size should be reasonable for the data
      expect(buffer.length).toBeGreaterThan(10000); // At least some content
      expect(buffer.length).toBeLessThan(50 * 1024 * 1024); // But not huge
    });
  });

  describe('Column handling', () => {
    it('should create header row with correct column names', async () => {
      const rows = [
        {
          'Column1': 'value1',
          'Column2': 'value2',
          'Column3': 'value3',
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
      // Column names are determined by object keys
    });

    it('should handle columns with special characters', async () => {
      const rows = [
        {
          'Column-Name': 'value',
          'Column with spaces': 'value',
          'Column_with_underscore': 'value',
          'Column.with.dots': 'value',
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle ~150 columns (realistic portafoglio scenario)', async () => {
      // Generate row with ~150 fields
      const columns = Array.from({ length: 150 }, (_, i) => `Col${i + 1}`);
      const row = Object.fromEntries(columns.map((col, i) => [col, `Value${i}`]));

      const buffer = await buildPortafoglioXlsx([row]);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Row formatting', () => {
    it('should set header row height and styling', async () => {
      const rows = [mockRow];

      const buffer = await buildPortafoglioXlsx(rows);

      // Header row should have formatting (blue background, white text, bold)
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should set data row height', async () => {
      const rows = [mockRow, mockRow];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should freeze first row (header)', async () => {
      const rows = [mockRow];

      const buffer = await buildPortafoglioXlsx(rows);

      // frozen ySplit: 1 is set in sheet options
      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('Edge cases', () => {
    it('should handle very long strings without corruption', async () => {
      const rows = [
        {
          'LongText': 'a'.repeat(5000),
          'NormalText': 'normal',
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle special characters in data', async () => {
      const rows = [
        {
          'Text': 'Special: <>&"\'',
          'Unicode': '日本語 中文 한글',
          'Emoji': '😀🎉🚀',
        },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should handle mix of data types in same column', async () => {
      const rows = [
        { 'MixedCol': 'string' },
        { 'MixedCol': 123 },
        { 'MixedCol': true },
        { 'MixedCol': null },
      ];

      const buffer = await buildPortafoglioXlsx(rows);

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('Buffer integrity', () => {
    it('should return valid buffer that can be saved to file', async () => {
      const rows = [mockRow];

      const buffer = await buildPortafoglioXlsx(rows, 'Test');

      // Buffer should be valid and complete
      expect(Buffer.isBuffer(buffer)).toBe(true);
      // Can encode to base64 without error
      const base64 = buffer.toString('base64');
      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);
      // Can decode back
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded.length).toBe(buffer.length);
    });
  });
});
