/**
 * Unit tests for Brand Logo Upload Service
 * Verifies MIME, size, magic bytes validations and upload logic
 */

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { appRouter } from '../src/routers/index';
import {
  uploadBrandLogo,
  uploadTempBrandLogo,
} from '../src/services/brandLogo.service';
import { resetStorageProvider } from '../src/storage';

import {
  createTestFile,
  createValidPngBuffer,
  createValidJpegBuffer,
  createInvalidImageBuffer,
  seedLocalStorageConfig,
} from './helpers/storageTestHelper';
import { createContextForRole } from './helpers/testContext';

import type { Context } from '../src/lib/trpc';

// Real local storage on a throwaway temp directory, not a module mock: `appRouter`
// is imported eagerly by `test/setup.procedureUsage.ts` (a `setupFiles` entry, for
// the procedure-coverage gate) before this file's own `vi.mock` hoisting could ever
// run, and `appRouter` now reaches `services/asset.service.ts` — which imports
// `../storage` — through `collectionLayout.ts`'s `resolveVariantUrls`. A module
// already evaluated by an earlier file can't be retroactively mocked, so
// `vi.mock('../src/storage', ...)` would silently do nothing here; a previous
// version of this file relied on exactly that, undetected, because none of its
// assertions happened to depend on the mock's literal return values. See
// `seedLocalStorageConfig` (`./helpers/storageTestHelper`) for the shared setup.

describe('Brand Logo Upload Service', () => {
  let testContext: Context;
  let basePath: string;

  beforeEach(async () => {
    testContext = await createContextForRole();
    basePath = await mkdtemp(join(tmpdir(), 'luke-brandlogo-service-'));
    await seedLocalStorageConfig(testContext.prisma, basePath, { buckets: ['brand-logos'], maxFileSizeMB: 2 });
  });

  afterEach(async () => {
    resetStorageProvider();
    await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  describe('uploadBrandLogo', () => {
    let testBrand: any;

    beforeEach(async () => {
      // Creates a test brand
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

      // The DB stores the storage key, not the public URL (derived at runtime)
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
      // First upload
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

      // Second upload (replace)
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

      // Verifies that the brand has the new logo
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

      // The filename should be sanitized
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

      // There's no longer a client-supplied `tempId` or a separate bucket:
      // the file ends up in `brand-logos` as a *pending* fileObject, and
      // gets confirmed when the brand is saved via `fileObjectId`.
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

  // Goes through `appRouter`, never `brandRouter`: `router({ brand: brandRouter })`
  // doesn't preserve the sub-router, it rebuilds an aggregate from it. Calling
  // it directly skips the composition that production goes through and is
  // invisible to the coverage gate, which measures invocations on `appRouter`.
  describe('conferma logo pending via brand.update', () => {
    let testBrand: any;

    beforeEach(async () => {
      // Creates a test brand
      testBrand = await testContext.prisma.brand.create({
        data: {
          code: 'TEST_BRAND',
          name: 'Test Brand',
          isActive: true,
        },
      });
    });

    it('confirms a pending upload and links it to the brand', async () => {
      // The pending row is created here by hand, in the state a real pending
      // upload would leave it in, so the test isolates the router's confirmation
      // logic (`confirmPendingFile`) from the upload path itself.
      const pending = await testContext.prisma.fileObject.create({
        data: {
          bucket: 'brand-logos',
          key: `pending-${Date.now()}.png`,
          originalName: 'temp-logo.png',
          contentType: 'image/png',
          size: 1024,
          checksumSha256: 'x'.repeat(64),
          createdBy: testContext.session!.user.id,
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

    it('confirms a pending master\'s derivatives alongside it, not just the master row', async () => {
      // A derivative is excluded from the reaper's own query (`parentId: null` in
      // `setupTempFileCleanup`) regardless of its own `confirmedAt`, so this isn't
      // required for the derivative to survive — but a bug here would leave every
      // derivative permanently `confirmedAt: null`, which is the kind of drift a
      // future feature ("list confirmed assets") could silently trip over.
      const pending = await testContext.prisma.fileObject.create({
        data: {
          bucket: 'brand-logos',
          key: `pending-${Date.now()}.png`,
          originalName: 'temp-logo.png',
          contentType: 'image/png',
          size: 1024,
          checksumSha256: 'x'.repeat(64),
          createdBy: testContext.session!.user.id,
          confirmedAt: null,
        },
      });
      const derivative = await testContext.prisma.fileObject.create({
        data: {
          bucket: 'brand-logos',
          key: `pending-${Date.now()}/v1/thumb.webp`,
          originalName: 'thumb',
          contentType: 'image/webp',
          size: 256,
          checksumSha256: 'y'.repeat(64),
          createdBy: testContext.session!.user.id,
          confirmedAt: null,
          parentId: pending.id,
          variant: 'thumb',
          pipelineVersion: 1,
        },
      });

      const caller = appRouter.createCaller(testContext).brand;
      await caller.update({
        id: testBrand.id,
        data: { name: 'Brand con logo e derivata', fileObjectId: pending.id },
      });

      const confirmedDerivative = await testContext.prisma.fileObject.findUnique({
        where: { id: derivative.id },
      });
      expect(confirmedDerivative?.confirmedAt).not.toBeNull();
    });

    it('rejects a fileObjectId that does not exist', async () => {
      const caller = appRouter.createCaller(testContext).brand;

      // Decision reversed. It used to pass silently, on the grounds that
      // "the logo is optional and a dangling reference isn't a reason to
      // reject saving the other fields". The realistic case, though, isn't
      // a made-up id: it's the hourly reaper that swept away the pending
      // `FileObject` while the user was distracted. The no-op saved the
      // brand without a logo while showing "updated" — data loss with a
      // success toast.
      await expect(
        caller.update({
          id: testBrand.id,
          data: {
            name: 'Brand senza logo',
            fileObjectId: '00000000-0000-0000-0000-000000000000',
          },
        })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      // And the rejection is total: the transaction must not leave the other
      // fields half-applied.
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(updatedBrand?.name).not.toBe('Brand senza logo');
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
      // Creates a stream that fails
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
