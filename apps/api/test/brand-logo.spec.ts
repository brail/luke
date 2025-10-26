/**
 * Test di integrazione per Brand Logo Upload
 * Verifica validazioni file, magic bytes e cleanup
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

import { uploadBrandLogo } from '../src/services/brandLogo.service';
import { createTestContext } from './helpers/testContext';

describe('Brand Logo Upload', () => {
  let testContext: any;
  let testBrand: any;

  beforeEach(async () => {
    testContext = await createTestContext();

    // Crea un brand di test
    testBrand = await testContext.prisma.brand.create({
      data: {
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      },
    });
  });

  afterEach(async () => {
    // Cleanup: elimina tutti i brand e file objects
    await testContext.prisma.fileObject.deleteMany();
    await testContext.prisma.brand.deleteMany();
    await testContext.prisma.user.deleteMany();
  });

  describe('file validation', () => {
    it('should reject non-image MIME types', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 fake pdf content');
      const pdfStream = Readable.from(pdfBuffer);

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: {
            filename: 'document.pdf',
            mimetype: 'application/pdf',
            stream: pdfStream,
            size: pdfBuffer.length,
          },
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('Tipo file non supportato'),
      });
    });

    it('should reject files > 2MB', async () => {
      // Crea un buffer di 3MB
      const largeBuffer = Buffer.alloc(3 * 1024 * 1024, 'x');
      const largeStream = Readable.from(largeBuffer);

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: {
            filename: 'large.jpg',
            mimetype: 'image/jpeg',
            stream: largeStream,
            size: largeBuffer.length,
          },
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('File troppo grande'),
      });
    });

    it('should reject files with invalid extensions', async () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // Valid JPEG magic bytes
      const jpegStream = Readable.from(jpegBuffer);

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: {
            filename: 'image.txt', // Estensione non valida
            mimetype: 'image/jpeg',
            stream: jpegStream,
            size: jpegBuffer.length,
          },
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('Estensione file non valida'),
      });
    });
  });

  describe('magic bytes validation', () => {
    it('should reject files with wrong magic bytes', async () => {
      // Buffer con magic bytes PNG ma MIME type JPEG
      const fakeBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const fakeStream = Readable.from(fakeBuffer);

      await expect(
        uploadBrandLogo(testContext, {
          brandId: testBrand.id,
          file: {
            filename: 'fake.jpg',
            mimetype: 'image/jpeg',
            stream: fakeStream,
            size: fakeBuffer.length,
          },
        })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File corrotto o tipo non valido',
      });
    });

    it('should accept valid PNG files', async () => {
      // Buffer PNG valido
      const pngBuffer = Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d, // IHDR chunk length
        0x49,
        0x48,
        0x44,
        0x52, // IHDR
        0x00,
        0x00,
        0x00,
        0x01, // width
        0x00,
        0x00,
        0x00,
        0x01, // height
        0x08,
        0x02,
        0x00,
        0x00,
        0x00, // bit depth, color type, etc.
        0x90,
        0x77,
        0x53,
        0xde, // CRC
      ]);
      const pngStream = Readable.from(pngBuffer);

      const result = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: {
          filename: 'test.png',
          mimetype: 'image/png',
          stream: pngStream,
          size: pngBuffer.length,
        },
      });

      expect(result).toHaveProperty('url');
      expect(result.url).toMatch(/^\/api\/uploads\/brand-logos\//);
    });

    it('should accept valid JPEG files', async () => {
      // Buffer JPEG valido (minimo)
      const jpegBuffer = Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe0, // JPEG signature
        0x00,
        0x10, // length
        0x4a,
        0x46,
        0x49,
        0x46,
        0x00,
        0x01, // JFIF
        0x01,
        0x01,
        0x00,
        0x00,
        0x01,
        0x00,
        0x01,
        0x00,
        0x00,
        0xff,
        0xd9, // EOI marker
      ]);
      const jpegStream = Readable.from(jpegBuffer);

      const result = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: {
          filename: 'test.jpg',
          mimetype: 'image/jpeg',
          stream: jpegStream,
          size: jpegBuffer.length,
        },
      });

      expect(result).toHaveProperty('url');
      expect(result.url).toMatch(/^\/api\/uploads\/brand-logos\//);
    });
  });

  describe('cleanup functionality', () => {
    it('should cleanup old logo on new upload', async () => {
      // Prima upload
      const firstBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const firstStream = Readable.from(firstBuffer);

      const firstResult = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: {
          filename: 'first.png',
          mimetype: 'image/png',
          stream: firstStream,
          size: firstBuffer.length,
        },
      });

      // Verifica che il primo logo sia stato salvato
      const brandAfterFirst = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(brandAfterFirst?.logoUrl).toBe(firstResult.url);

      // Secondo upload
      const secondBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
      const secondStream = Readable.from(secondBuffer);

      const secondResult = await uploadBrandLogo(testContext, {
        brandId: testBrand.id,
        file: {
          filename: 'second.jpg',
          mimetype: 'image/jpeg',
          stream: secondStream,
          size: secondBuffer.length,
        },
      });

      // Verifica che il secondo logo abbia sostituito il primo
      const brandAfterSecond = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(brandAfterSecond?.logoUrl).toBe(secondResult.url);
      expect(brandAfterSecond?.logoUrl).not.toBe(firstResult.url);
    });
  });

  describe('error handling', () => {
    it('should throw NOT_FOUND for non-existent brand', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const stream = Readable.from(buffer);

      await expect(
        uploadBrandLogo(testContext, {
          brandId: nonExistentId,
          file: {
            filename: 'test.png',
            mimetype: 'image/png',
            stream: stream,
            size: buffer.length,
          },
        })
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Brand non trovato',
      });
    });
  });
});
