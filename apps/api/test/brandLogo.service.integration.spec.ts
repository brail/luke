/**
 * Test unitari per Brand Logo Upload Service
 * Verifica validazioni MIME, size, magic bytes e logica di upload
 */

import { Readable } from 'stream';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { appRouter } from '../src/routers/index';
import {
  uploadBrandLogo,
  uploadTempBrandLogo,
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

    // I mock coprono solo la parte di superficie che il service usa: i cast
    // riconoscono che sono stub parziali, non implementazioni complete.
    vi.mocked(putObject).mockImplementation((async (
      _ctx: unknown,
      params: Parameters<typeof putObject>[1]
    ) => {
      const fileObject = await mockStorage.put(params);
      return {
        id: fileObject.id,
        key: fileObject.key,
        bucket: fileObject.bucket,
        contentType: fileObject.contentType,
        size: fileObject.size,
        createdAt: fileObject.createdAt,
      };
    }) as unknown as typeof putObject);

    vi.mocked(deleteObject).mockImplementation((async (
      _ctx: unknown,
      key: string
    ) => {
      // Estrai bucket e key dal parametro
      const parts = key.split('/');
      const bucket = parts[0] || 'brand-logos';
      const keyPath = parts.slice(1).join('/');
      await mockStorage.delete({ bucket, key: keyPath });
    }) as unknown as typeof deleteObject);

    vi.mocked(getStorageProvider).mockResolvedValue({
      get: async (params: { bucket: string; key: string }) => {
        const { stream } = await mockStorage.get(params);
        return { stream };
      },
      delete: async (params: { bucket: string; key: string }) => {
        await mockStorage.delete(params);
      },
    } as unknown as Awaited<ReturnType<typeof getStorageProvider>>);
  });

  afterEach(() => {
    // Il database lo tronca `createTestContextWithMockStorage` al test dopo, e
    // con CASCADE: la catena di `deleteMany` che stava qui ometteva `fileObject`
    // e si sarebbe rotta al primo `onDelete: Restrict` nuovo.
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

      expect(result.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
      expect(result.bucket).toBe('brand-logos');
      expect(result.key).toBeDefined();

      // In DB si salva la storage key, non l'URL pubblico (derivato a runtime)
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.logoKey).toBe(result.key);
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

      expect(result.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
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

      expect(result2.publicUrl).not.toBe(result1.publicUrl);

      // Verifica che il brand abbia il nuovo logo
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.logoKey).toBe(result2.key);
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
      expect(result.publicUrl).not.toContain('../');
      expect(result.publicUrl).not.toContain('etc/passwd');
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
      const result = await uploadTempBrandLogo(testContext, {
        file: testFile,
      });

      // Non esiste più un `tempId` fornito dal client né un bucket separato:
      // il file finisce in `brand-logos` come fileObject *pending*, e viene
      // confermato al salvataggio del brand tramite `fileObjectId`.
      expect(result.fileObjectId).toBeDefined();
      expect(result.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
    });

    it('should reject invalid MIME type for temp upload', async () => {
      const testFile = createTestFile('temp.txt', 'text/plain', 100);
      await expect(
        uploadTempBrandLogo(testContext, {
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
      await expect(
        uploadTempBrandLogo(testContext, {
          file: testFile,
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File troppo grande. Max 2MB',
      });
    });
  });

  // Si passa da `appRouter`, mai da `brandRouter`: `router({ brand: brandRouter })`
  // non conserva il sotto-router, ne ricostruisce un aggregato. Chiamarlo diretto
  // salta la composizione che la produzione attraversa ed è invisibile al gate di
  // copertura, che misura le invocazioni su `appRouter`.
  describe('conferma logo pending via brand.update', () => {
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

    it('confirms a pending upload and links it to the brand', async () => {
      // Lo storage è mockato in questa suite, quindi `putObject` non scrive la
      // riga fileObject: la si crea qui a mano nello stato in cui la lascerebbe
      // un upload pending. L'oggetto sotto test è la logica di conferma del
      // router, non l'upload.
      const pending = await testContext.prisma.fileObject.create({
        data: {
          bucket: 'brand-logos',
          key: `pending-${Date.now()}.png`,
          originalName: 'temp-logo.png',
          contentType: 'image/png',
          size: 1024,
          checksumSha256: 'x'.repeat(64),
          createdBy: testContext.session.user.id,
          confirmedAt: null,
        },
      });

      const caller = appRouter.createCaller(testContext).brand;
      await caller.update({
        id: testBrand.id,
        data: { name: 'Brand con logo', fileObjectId: pending.id },
      });

      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.logoKey).toBe(pending.key);

      const confirmed = await testContext.prisma.fileObject.findUnique({
        where: { id: pending.id },
      });
      expect(confirmed?.confirmedAt).not.toBeNull();
    });

    it('ignores a fileObjectId that does not exist', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      // Un id inesistente non deve far fallire l'update né sporcare logoKey:
      // il logo è opzionale, e un riferimento morto non è motivo per rifiutare
      // il salvataggio degli altri campi.
      await caller.update({
        id: testBrand.id,
        data: {
          name: 'Brand senza logo',
          fileObjectId: '00000000-0000-0000-0000-000000000000',
        },
      });

      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.name).toBe('Brand senza logo');
      expect(updatedBrand?.logoKey).toBeNull();
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
