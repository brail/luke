/**
 * Test integration per Brand Logo Upload Endpoints
 * Verifica endpoint Fastify multipart con supertest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { FastifyInstance } from 'fastify';
import { Readable } from 'stream';

import { createTestContext } from './helpers/testContext';
import {
  createValidPngBuffer,
  createValidJpegBuffer,
  createInvalidImageBuffer,
} from './helpers/storageTestHelper';

// Mock del storage module
vi.mock('../src/storage', () => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  getStorageProvider: vi.fn(),
}));

// Mock del brandLogo service
vi.mock('../src/services/brandLogo.service', () => ({
  uploadBrandLogo: vi.fn(),
  uploadTempBrandLogo: vi.fn(),
}));

describe('Brand Logo Upload Integration', () => {
  let app: FastifyInstance;
  let testContext: any;
  let testBrand: any;
  let authToken: string;

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

    // Mock JWT token per autenticazione
    authToken = 'mock-jwt-token';

    // Mock delle funzioni storage
    const { putObject, deleteObject, getStorageProvider } = await import(
      '../src/storage'
    );
    const { uploadBrandLogo, uploadTempBrandLogo } = await import(
      '../src/services/brandLogo.service'
    );

    vi.mocked(putObject).mockResolvedValue({
      id: 'mock-file-id',
      key: 'mock-key',
      bucket: 'brand-logos',
      contentType: 'image/png',
      size: 1000,
      createdAt: new Date(),
    });

    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(getStorageProvider).mockResolvedValue({
      get: vi.fn(),
      delete: vi.fn(),
    });

    vi.mocked(uploadBrandLogo).mockResolvedValue({
      publicUrl: '/api/uploads/brand-logos/mock-key',
      bucket: 'brand-logos',
      key: 'mock-key',
    });

    vi.mocked(uploadTempBrandLogo).mockResolvedValue({
      publicUrl: '/api/uploads/temp-brand-logos/temp-123/mock-key',
      tempLogoId: 'temp-123',
    });

    // Crea app Fastify per test
    const fastify = (await import('fastify')).default;
    app = fastify({ logger: false });

    // Registra plugin multipart
    await app.register(require('@fastify/multipart'), {
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB
        files: 1,
      },
    });

    // Registra plugin rate limit
    await app.register(require('@fastify/rate-limit'), {
      max: 100, // Più permissivo per test
      timeWindow: '1 minute',
      keyGenerator: (req: any) => req.ip,
    });

    // Mock authenticateRequest
    vi.doMock('../src/lib/auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          username: 'testuser',
          firstName: 'Test',
          lastName: 'User',
          role: 'admin',
          tokenVersion: 0,
        },
      }),
    }));

    // Registra le route di upload
    await app.register(require('../src/routes/brandLogo.routes'), {
      prisma: testContext.prisma,
    });
  });

  afterEach(async () => {
    // Cleanup
    await testContext.prisma.userPreference.deleteMany();
    await testContext.prisma.brand.deleteMany();
    await testContext.prisma.user.deleteMany();
    await app.close();
    vi.clearAllMocks();
  });

  describe('POST /upload/brand-logo/:brandId', () => {
    it('should upload brand logo successfully', async () => {
      const pngBuffer = createValidPngBuffer();

      const response = await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test-logo.png')
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
      expect(response.body).toHaveProperty('bucket');
      expect(response.body).toHaveProperty('key');
      expect(response.body.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
      expect(response.body.bucket).toBe('brand-logos');
    });

    it('should reject request without authentication', async () => {
      const pngBuffer = createValidPngBuffer();

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .attach('file', pngBuffer, 'test-logo.png')
        .expect(401);
    });

    it('should reject request without file', async () => {
      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should reject invalid file type', async () => {
      const textBuffer = Buffer.from('This is not an image');

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', textBuffer, 'test.txt')
        .expect(400);
    });

    it('should reject file too large', async () => {
      const largeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', largeBuffer, 'large.png')
        .expect(400);
    });

    it('should reject non-existent brand', async () => {
      const pngBuffer = createValidPngBuffer();
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app)
        .post(`/upload/brand-logo/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test.png')
        .expect(404);
    });

    it('should handle multiple file uploads (should reject)', async () => {
      const pngBuffer = createValidPngBuffer();

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test1.png')
        .attach('file', pngBuffer, 'test2.png')
        .expect(400);
    });

    it('should handle corrupted file stream', async () => {
      // Crea uno stream che fallisce
      const corruptedStream = new Readable({
        read() {
          this.emit('error', new Error('Stream corrupted'));
        },
      });

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', corruptedStream, 'corrupted.png')
        .expect(500);
    });
  });

  describe('POST /upload/brand-logo/temp', () => {
    it('should upload temp logo successfully', async () => {
      const pngBuffer = createValidPngBuffer();

      const response = await request(app)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .field('tempId', 'temp-123')
        .attach('file', pngBuffer, 'temp-logo.png')
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
      expect(response.body).toHaveProperty('tempLogoId');
      expect(response.body.tempLogoId).toBe('temp-123');
      expect(response.body.publicUrl).toMatch(
        /^\/api\/uploads\/temp-brand-logos\//
      );
    });

    it('should reject request without authentication', async () => {
      const pngBuffer = createValidPngBuffer();

      await request(app)
        .post('/upload/brand-logo/temp')
        .field('tempId', 'temp-123')
        .attach('file', pngBuffer, 'temp-logo.png')
        .expect(401);
    });

    it('should reject request without tempId', async () => {
      const pngBuffer = createValidPngBuffer();

      await request(app)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'temp-logo.png')
        .expect(400);
    });

    it('should reject request without file', async () => {
      await request(app)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .field('tempId', 'temp-123')
        .expect(400);
    });

    it('should reject invalid file type for temp upload', async () => {
      const textBuffer = Buffer.from('This is not an image');

      await request(app)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .field('tempId', 'temp-123')
        .attach('file', textBuffer, 'test.txt')
        .expect(400);
    });
  });

  describe('Rate limiting', () => {
    it('should enforce rate limiting', async () => {
      const pngBuffer = createValidPngBuffer();

      // Fai molte richieste rapidamente
      const promises = Array.from({ length: 150 }, () =>
        request(app)
          .post(`/upload/brand-logo/${testBrand.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .attach('file', pngBuffer, 'test.png')
      );

      const responses = await Promise.all(promises);

      // Alcune richieste dovrebbero essere rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle service layer errors gracefully', async () => {
      const { uploadBrandLogo } = await import(
        '../src/services/brandLogo.service'
      );

      // Mock service per lanciare errore
      vi.mocked(uploadBrandLogo).mockRejectedValue(
        new Error('Service layer error')
      );

      const pngBuffer = createValidPngBuffer();

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test.png')
        .expect(500);
    });

    it('should handle malformed multipart data', async () => {
      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'multipart/form-data')
        .send('malformed data')
        .expect(400);
    });
  });

  describe('File validation edge cases', () => {
    it('should handle empty filename', async () => {
      const pngBuffer = createValidPngBuffer();

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, '')
        .expect(400);
    });

    it('should handle filename with special characters', async () => {
      const pngBuffer = createValidPngBuffer();

      const response = await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test@#$%^&*().png')
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
    });

    it('should handle very long filename', async () => {
      const pngBuffer = createValidPngBuffer();
      const longFilename = 'a'.repeat(300) + '.png';

      await request(app)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, longFilename)
        .expect(400);
    });
  });
});
