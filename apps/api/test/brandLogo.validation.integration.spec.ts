/**
 * Integration test for Brand Logo Upload
 * Verifies file validation, magic bytes, and cleanup
 *
 * Buffers come from `helpers/storageTestHelper`, like the other two specs
 * on logo: here they were written by hand one byte per row, and the same PNG signature
 * of 32 bytes appeared twice in the same file.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { uploadBrandLogo } from '../src/services/brandLogo.service';

import {
  createInvalidImageBuffer,
  createTestFile,
  createValidJpegBuffer,
  createValidPngBuffer,
} from './helpers/storageTestHelper';
import { createContextForRole } from './helpers/testContext';

describe('Brand Logo Upload', () => {
  let testContext: any;
  let testBrand: any;

  beforeEach(async () => {
    // `createContextForRole` truncates before inserting the session user:
    // no manual cleanup downstream, which incidentally omitted `fileObject`.
    testContext = await createContextForRole();

    // Creates a test brand
    testBrand = await testContext.prisma.brand.create({
      data: {
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      },
    });
  });

  /** Uploads `content` as the test brand logo. */
  function upload(filename: string, mimetype: string, content: Buffer) {
    return uploadBrandLogo(testContext, {
      brandId: testBrand.id,
      file: createTestFile(filename, mimetype, content.length, content),
    });
  }

  describe('file validation', () => {
    it('should reject non-image MIME types', async () => {
      const pdf = Buffer.from('%PDF-1.4 fake pdf content');

      await expect(
        upload('document.pdf', 'application/pdf', pdf)
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('Tipo file non supportato'),
      });
    });

    it('should reject files > 2MB', async () => {
      const large = Buffer.alloc(3 * 1024 * 1024, 'x');

      await expect(
        upload('large.jpg', 'image/jpeg', large)
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('File troppo grande'),
      });
    });

    it('should reject files with invalid extensions', async () => {
      await expect(
        upload('image.txt', 'image/jpeg', createValidJpegBuffer())
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('Estensione file non valida'),
      });
    });
  });

  describe('magic bytes validation', () => {
    it('should reject files with wrong magic bytes', async () => {
      // PNG magic bytes declared as JPEG
      await expect(
        upload('fake.jpg', 'image/jpeg', createValidPngBuffer())
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File corrotto o tipo non valido',
      });
    });

    it('should reject content that is not an image at all', async () => {
      await expect(
        upload('fake.png', 'image/png', createInvalidImageBuffer())
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'File corrotto o tipo non valido',
      });
    });

    it('should accept valid PNG files', async () => {
      const result = await upload('test.png', 'image/png', createValidPngBuffer());

      expect(result.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
    });

    it('should accept valid JPEG files', async () => {
      const result = await upload(
        'test.jpg',
        'image/jpeg',
        createValidJpegBuffer()
      );

      expect(result.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
    });
  });

  describe('cleanup functionality', () => {
    it('should cleanup old logo on new upload', async () => {
      const first = await upload('first.png', 'image/png', createValidPngBuffer());

      // Verifies the first logo was saved
      const brandAfterFirst = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(brandAfterFirst?.logoKey).toBe(first.key);

      const second = await upload(
        'second.jpg',
        'image/jpeg',
        createValidJpegBuffer()
      );

      // Verifies the second logo replaced the first
      const brandAfterSecond = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });
      expect(brandAfterSecond?.logoKey).toBe(second.key);
      expect(brandAfterSecond?.logoKey).not.toBe(first.key);
    });
  });

  describe('transaction atomicity', () => {
    it('should update brand logoKey atomically', async () => {
      const result = await upload('test.png', 'image/png', createValidPngBuffer());

      // Verifies the brand was updated with the new logoKey
      const updatedBrand = await testContext.prisma.brand.findUnique({
        where: { id: testBrand.id },
      });

      expect(updatedBrand?.logoKey).toBe(result.key);
      expect(result.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
    });
  });
});
