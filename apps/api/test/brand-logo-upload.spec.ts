/**
 * Test unitari per Brand Logo Upload Service
 * Verifica validazioni MIME, size, magic bytes e logica di upload
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { Readable } from 'stream';

import {
  uploadBrandLogo,
  uploadTempBrandLogo,
  moveTempLogoToBrand,
} from '../src/services/brandLogo.service';
import {
  createTestContextWithMockStorage,
  createTestFile,
  createValidPngBuffer,
  createValidJpegBuffer,
  createInvalidImageBuffer,
  MockStorageProvider,
} from './helpers/storageTestHelper';

// Mock del storage module
vi.mock('../src/storage', () => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  getStorageProvider: vi.fn(),
}));

describe('Brand Logo Upload Service', () => {
  let testContext: any;
  let mockStorage: MockStorageProvider;

  beforeEach(async () => {
    testContext = await createTestContextWithMockStorage();
    mockStorage = testContext.mockStorage;

    // Mock delle funzioni storage
    const { putObject, deleteObject, getStorageProvider } = await import(
      '../src/storage'
    );

    vi.mocked(putObject).mockImplementation(async (ctx: any, params: any) => {
      const fileObject = await mockStorage.put(params);
      return {
        id: fileObject.id,
        key: fileObject.key,
        bucket: fileObject.bucket,
        contentType: fileObject.contentType,
        size: fileObject.size,
        createdAt: fileObject.createdAt,
      };
    });

    vi.mocked(deleteObject).mockImplementation(
      async (ctx: any, key: string) => {
        // Estrai bucket e key dal parametro
        const parts = key.split('/');
        const bucket = parts[0] || 'brand-logos';
        const keyPath = parts.slice(1).join('/');
        await mockStorage.delete({ bucket, key: keyPath });
      }
    );

    vi.mocked(getStorageProvider).mockResolvedValue({
      get: async (params: any) => {
        const { stream } = await mockStorage.get(params);
        return { stream };
      },
      delete: async (params: any) => {
        await mockStorage.delete(params);
      },
    });
  });

  afterEach(async () => {
    // Cleanup: elimina tutti i brand e file test creati
    await testContext.prisma.userPreference.deleteMany();
    await testContext.prisma.brand.deleteMany();
    await testContext.prisma.user.deleteMany();
    mockStorage.clear();
    vi.clearAllMocks();
  });

  describe('uploadBrandLogo', () => {
    let testBrand: any;

    beforeEach(async () => {
      // Crea un brand di test
      testBrand = await testContext.prisma.brand.create({
        data: {
          code: 'TEST_BRAND',
          name: 'Test Brand',
          isActive: true,
        },
      });
    });

    it('should upload valid PNG logo successfully', async () => {
      const pngBuffer = createValidPngBuffer();
      const testFile = createTestFile(
        'test-logo.png',
        'image/png',
        pngBuffer.length,
        pngBuffer
      );

      const result = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: testFile,
      });

      expect(result.url).toMatch(/^\/api\/uploads\/brand-logos\//);

      // Verifica che il brand sia stato aggiornato con il logoUrl
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.logoUrl).toBe(result.url);
    });

    it('should upload valid JPEG logo successfully', async () => {
      const jpegBuffer = createValidJpegBuffer();
      const testFile = createTestFile(
        'test-logo.jpg',
        'image/jpeg',
        jpegBuffer.length,
        jpegBuffer
      );

      const result = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: testFile,
      });

      expect(result.url).toMatch(/^\/api\/uploads\/brand-logos\//);
    });

    it('should reject invalid MIME type', async () => {
      const testFile = createTestFile('test.txt', 'text/plain', 100);

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message:
          'Tipo file non supportato. Usa: image/png, image/jpeg, image/jpg, image/webp',
      });
    });

    it('should reject file too large', async () => {
      const largeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB
      const testFile = createTestFile(
        'large.png',
        'image/png',
        largeBuffer.length,
        largeBuffer
      );

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File troppo grande. Max 2MB',
      });
    });

    it('should reject file with invalid magic bytes', async () => {
      const invalidBuffer = createInvalidImageBuffer();
      const testFile = createTestFile(
        'fake-image.png',
        'image/png',
        invalidBuffer.length,
        invalidBuffer
      );

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File corrotto o tipo non valido',
      });
    });

    it('should reject invalid file extension', async () => {
      const pngBuffer = createValidPngBuffer();
      const testFile = createTestFile(
        'test.gif',
        'image/png',
        pngBuffer.length,
        pngBuffer
      );

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Estensione file non valida. Usa: .png, .jpg, .jpeg, .webp',
      });
    });

    it('should reject non-existent brand', async () => {
      const pngBuffer = createValidPngBuffer();
      const testFile = createTestFile(
        'test.png',
        'image/png',
        pngBuffer.length,
        pngBuffer
      );
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await expect(
        uploadBrandLogo(testContext, {
          brandId: nonExistentId,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Brand non trovato',
      });
    });

    it('should replace existing logo and cleanup old file', async () => {
      // Prima upload
      const pngBuffer1 = createValidPngBuffer();
      const testFile1 = createTestFile(
        'logo1.png',
        'image/png',
        pngBuffer1.length,
        pngBuffer1
      );

      const result1 = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: testFile1,
      });

      // Seconda upload (replace)
      const pngBuffer2 = createValidPngBuffer();
      const testFile2 = createTestFile(
        'logo2.png',
        'image/png',
        pngBuffer2.length,
        pngBuffer2
      );

      const result2 = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: testFile2,
      });

      expect(result2.url).not.toBe(result1.url);

      // Verifica che il brand abbia il nuovo logo
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.logoUrl).toBe(result2.url);
    });

    it('should sanitize filename to prevent path traversal', async () => {
      const pngBuffer = createValidPngBuffer();
      const maliciousFile = createTestFile(
        '../../../etc/passwd.png',
        'image/png',
        pngBuffer.length,
        pngBuffer
      );

      const result = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: maliciousFile,
      });

      // Il filename dovrebbe essere sanitizzato
      expect(result.url).not.toContain('../');
      expect(result.url).not.toContain('etc/passwd');
    });
  });

  describe('uploadTempBrandLogo', () => {
    it('should upload temporary logo successfully', async () => {
      const pngBuffer = createValidPngBuffer();
      const testFile = createTestFile(
        'temp-logo.png',
        'image/png',
        pngBuffer.length,
        pngBuffer
      );
      const tempId = 'temp-123';

      const result = await uploadTempBrandLogo(testContext, {
        tempId,
        file: testFile,
      });

      expect(result.tempLogoId).toBe(tempId);
      expect(result.tempLogoUrl).toMatch(/^\/api\/uploads\/temp-brand-logos\//);
    });

    it('should reject invalid MIME type for temp upload', async () => {
      const testFile = createTestFile('temp.txt', 'text/plain', 100);
      const tempId = 'temp-123';

      await expect(
        uploadTempBrandLogo(testContext, {
          tempId,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message:
          'Tipo file non supportato. Usa: image/png, image/jpeg, image/jpg, image/webp',
      });
    });

    it('should reject file too large for temp upload', async () => {
      const largeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB
      const testFile = createTestFile(
        'large.png',
        'image/png',
        largeBuffer.length,
        largeBuffer
      );
      const tempId = 'temp-123';

      await expect(
        uploadTempBrandLogo(testContext, {
          tempId,
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File troppo grande. Max 2MB',
      });
    });
  });

  describe('moveTempLogoToBrand', () => {
    let testBrand: any;

    beforeEach(async () => {
      // Crea un brand di test
      testBrand = await testContext.prisma.brand.create({
        data: {
          code: 'TEST_BRAND',
          name: 'Test Brand',
          isActive: true,
        },
      });
    });

    it('should move temp logo to brand successfully', async () => {
      const tempId = 'temp-123';
      const pngBuffer = createValidPngBuffer();

      // Prima crea un file temporaneo
      await mockStorage.put({
        bucket: 'temp-brand-logos',
        key: `${tempId}/temp-logo.png`,
        contentType: 'image/png',
        size: pngBuffer.length,
        stream: Readable.from(pngBuffer),
      });

      // Mock del fileObject nel DB
      await testContext.prisma.fileObject.create({
        data: {
          bucket: 'temp-brand-logos',
          key: `${tempId}/temp-logo.png`,
          contentType: 'image/png',
          size: pngBuffer.length,
        },
      });

      const result = await moveTempLogoToBrand(testContext, {
        tempLogoId: tempId,
        brandId: testBrand.id,
      });

      expect(result.url).toMatch(/^\/api\/uploads\/brand-logos\//);

      // Verifica che il brand sia stato aggiornato
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.logoUrl).toBe(result.url);
    });

    it('should reject move for non-existent temp file', async () => {
      const tempId = 'non-existent';

      await expect(
        moveTempLogoToBrand(testContext, {
          tempLogoId: tempId,
          brandId: testBrand.id,
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'File temporaneo non trovato',
      });
    });
  });

  describe('edge cases and error handling', () => {
    let testBrand: any;

    beforeEach(async () => {
      testBrand = await testContext.prisma.brand.create({
        data: {
          code: 'TEST_BRAND',
          name: 'Test Brand',
          isActive: true,
        },
      });
    });

    it('should handle empty filename gracefully', async () => {
      const pngBuffer = createValidPngBuffer();
      const testFile = createTestFile(
        '',
        'image/png',
        pngBuffer.length,
        pngBuffer
      );

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toThrow();
    });

    it('should handle zero-size file', async () => {
      const testFile = createTestFile(
        'empty.png',
        'image/png',
        0,
        Buffer.alloc(0)
      );

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toThrow();
    });

    it('should handle corrupted stream', async () => {
      // Crea uno stream che fallisce
      const corruptedStream = new Readable({
        read() {
          this.emit('error', new Error('Stream corrupted'));
        },
      });

      const testFile = {
        filename: 'corrupted.png',
        mimetype: 'image/png',
        stream: corruptedStream,
        size: 100,
      };

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: testFile,
        })
      ).rejects.toThrow('Stream corrupted');
    });
  });
});
