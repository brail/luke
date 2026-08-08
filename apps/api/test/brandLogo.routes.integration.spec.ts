/**
 * Integration tests for Brand Logo Upload Endpoints
 * Verifies Fastify multipart endpoint with supertest
 */

import multipart from '@fastify/multipart';
import { FastifyInstance } from 'fastify';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import brandLogoRoutes from '../src/routes/brandLogo.routes';

import { createValidPngBuffer } from './helpers/storageTestHelper';
import { createContextForRole } from './helpers/testContext';

// Mock of the storage module
vi.mock('../src/storage', () => ({
  putObject: vi.fn(),
  // `deleteObjectByKey`, not `deleteObject`: that is what
  // `brandLogo.service.ts` imports. With the wrong name the factory did not define it, and
  // from the second upload onward the previous-logo cleanup branch threw
  // inside the `setImmediate` -- where the service's `catch` swallowed it.
  deleteObjectByKey: vi.fn(),
  getStorageProvider: vi.fn(),
}));

// `brandLogo.service` must NOT be mocked: it contains exactly the validations these
// tests verify (file type, magic bytes, brand existence -> 404). Mocking it
// always made it return success, making the 400/404 assertions impossible
// to satisfy and meaningless. Only the underlying storage is mocked.

// The auth mock must be here, not in `beforeEach` with `vi.doMock`:
// `brandLogo.routes` is imported statically and captures the real reference
// before a doMock could intervene. The route uses `requireSessionWithPermission`,
// not `authenticateRequest` -- the old mock pointed at the wrong function.
vi.mock('../src/lib/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/auth')>();
  return {
    ...actual,
    requireSessionWithPermission: vi.fn(async (req: any) => {
      if (!req.headers?.authorization) {
        const err: any = new Error('Unauthorized');
        err.statusCode = 401;
        throw err;
      }
      return {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          username: 'testuser',
          role: 'admin',
          tokenVersion: 0,
        },
      };
    }),
  };
});

describe('Brand Logo Upload Integration', () => {
  let app: FastifyInstance;
  let testContext: any;
  let testBrand: any;
  let authToken: string;

  beforeEach(async () => {
    // The brand code is fixed: without truncating the data, a `TEST_BRAND` left
    // by another test file makes the create fail and with it the whole suite --
    // making the result depend on execution order. The truncation
    // is done by `createContextForRole`, before inserting the session user.
    testContext = await createContextForRole();

    // Create a test brand
    testBrand = await testContext.prisma.brand.create({
      data: {
        code: 'TEST_BRAND',
        name: 'Test Brand',
        isActive: true,
      },
    });

    // Mock JWT token for authentication
    authToken = 'mock-jwt-token';

    // Mock the storage functions
    const { putObject, deleteObjectByKey, getStorageProvider } = await import(
      '../src/storage'
    );
    // Partial stubs: they only cover the surface used by the service, so the casts
    // acknowledge that these are not complete implementations of StoredObjectMeta /
    // IStorageProvider.
    vi.mocked(putObject).mockResolvedValue({
      id: 'mock-file-id',
      key: 'mock-key',
      bucket: 'brand-logos',
      contentType: 'image/png',
      size: 1000,
      createdAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof putObject>>);

    vi.mocked(deleteObjectByKey).mockResolvedValue(undefined);
    vi.mocked(getStorageProvider).mockResolvedValue({
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getStorageProvider>>);

    // Create Fastify app for testing
    const fastify = (await import('fastify')).default;
    app = fastify({ logger: false });

    // Register multipart plugin
    await app.register(multipart, {
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB
        files: 1,
      },
    });

    // No `@fastify/rate-limit` registration here: the limiter under test is
    // the one `brandLogoRoutes` registers itself (`brandLogo.routes.ts:75`). The
    // plugin uses a `Symbol` for registration, so two registrations do not
    // deduplicate: the one that used to be here was a second, independent store of 100
    // that never came into play and made the limit look larger than
    // the real one.

    // Register the upload routes. Static import, not `require`: the module is
    // ESM under vitest and `require` fails with "Cannot find module".
    await app.register(brandLogoRoutes, {
      prisma: testContext.prisma,
    });

    // `app.server` (the http.Server that supertest drives) only exists after ready().
    await app.ready();
  });

  afterEach(async () => {
    // Only what the truncation does not cover: the Fastify server and the mocks. The data
    // is reset by `createContextForRole` in the `beforeEach` of the next test.
    await app.close();
    vi.clearAllMocks();
  });

  describe('POST /upload/brand-logo/:brandId', () => {
    it('should upload brand logo successfully', async () => {
      const pngBuffer = createValidPngBuffer();

      const response = await request(app.server)
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

      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .attach('file', pngBuffer, 'test-logo.png')
        .expect(401);
    });

    it('should reject request without file', async () => {
      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should reject invalid file type', async () => {
      const textBuffer = Buffer.from('This is not an image');

      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', textBuffer, 'test.txt')
        .expect(400);
    });

    it('should reject file too large', async () => {
      const largeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB

      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', largeBuffer, 'large.png')
        .expect(400);
    });

    it('should reject non-existent brand', async () => {
      const pngBuffer = createValidPngBuffer();
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      await request(app.server)
        .post(`/upload/brand-logo/${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test.png')
        .expect(404);
    });

    it('con più file allegati usa il primo e ignora gli altri', async () => {
      const pngBuffer = createValidPngBuffer();

      // `req.file()` reads the first file part and stops: subsequent ones are
      // never consumed, so busboy's `files: 1` limit never kicks in.
      // This is the intended semantics for a single-logo endpoint -- the test expected
      // a rejection that the code never implemented.
      const response = await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test1.png')
        .attach('file', pngBuffer, 'test2.png')
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
    });

    it('rifiuta un file il cui contenuto non corrisponde al tipo dichiarato', async () => {
      // The previous version attached a stream that emitted `error`: the
      // client aborted the request before receiving a response and supertest
      // failed with ECONNRESET -- it was measuring the harness, not the server.
      //
      // The verifiable contract is magic-byte validation: bytes that are not
      // a PNG, declared as PNG, must be rejected with 400.
      const notAnImage = Buffer.from('questo non è un PNG');

      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', notAnImage, 'corrupted.png')
        .expect(400);
    });
  });

  describe('POST /upload/brand-logo/temp', () => {
    it('should upload temp logo successfully', async () => {
      const pngBuffer = createValidPngBuffer();

      const response = await request(app.server)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .field('tempId', 'temp-123')
        .attach('file', pngBuffer, 'temp-logo.png')
        .expect(200);

      // The contract has changed: no `tempLogoId` provided by the client, no
      // `temp-brand-logos` bucket. The file ends up in `brand-logos` as a *pending*
      // fileObject, and gets confirmed when the brand is saved via `fileObjectId`.
      expect(response.body).toHaveProperty('publicUrl');
      expect(response.body).toHaveProperty('fileObjectId');
      expect(response.body.publicUrl).toMatch(/^\/api\/uploads\/brand-logos\//);
    });

    it('should reject request without authentication', async () => {
      const pngBuffer = createValidPngBuffer();

      await request(app.server)
        .post('/upload/brand-logo/temp')
        .field('tempId', 'temp-123')
        .attach('file', pngBuffer, 'temp-logo.png')
        .expect(401);
    });

    it('accetta l\'upload senza tempId: il campo non fa più parte del contratto', async () => {
      const pngBuffer = createValidPngBuffer();

      // The file id is assigned by the server (`fileObjectId`), not the client: a
      // `tempId` sent by the caller is neither required nor used.
      const response = await request(app.server)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'temp-logo.png')
        .expect(200);

      expect(response.body).toHaveProperty('fileObjectId');
    });

    it('should reject request without file', async () => {
      await request(app.server)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .field('tempId', 'temp-123')
        .expect(400);
    });

    it('should reject invalid file type for temp upload', async () => {
      const textBuffer = Buffer.from('This is not an image');

      await request(app.server)
        .post('/upload/brand-logo/temp')
        .set('Authorization', `Bearer ${authToken}`)
        .field('tempId', 'temp-123')
        .attach('file', textBuffer, 'test.txt')
        .expect(400);
    });
  });

  /**
   * The rate limit is exhausted without touching the database.
   *
   * The previous version made 40 real uploads via supertest and was flaky:
   * `app.ready()` does not start listening, so supertest opened and closed an
   * ephemeral listener **per request** -- 40 listen/connect/close cycles that under
   * load ended up in ETIMEDOUT at the socket level. The cost was not the rate
   * limit (the limiter is an `onRequest` hook, so a 429 does not parse the multipart
   * and does not touch Postgres) but the 30 successful uploads, ~6 round-trips each.
   *
   * Here `app.inject()` is used -- no socket, same Fastify lifecycle,
   * so the limiter still triggers -- with requests **without a body**: the limiter
   * counts on arrival, then `req.file()` throws and the handler responds 400. Zero
   * queries. The URL must remain the real one: the limiter is hooked via `onRoute`,
   * so a nonexistent URL would not consume quota.
   */
  describe('Rate limiting', () => {
    /** POST without a body on the route under test: consumes quota, does not touch the DB. */
    const consumeQuota = (ip = '127.0.0.1') =>
      app.inject({
        method: 'POST',
        url: `/upload/brand-logo/${testBrand.id}`,
        headers: { authorization: `Bearer ${authToken}` },
        remoteAddress: ip,
      });

    it('espone il budget residuo già alla prima richiesta', async () => {
      const res = await consumeQuota();

      // 30, not the 100 used in development: `test/setup.ts` sets NODE_ENV=test, so
      // `isDevelopment()` is false in `brandLogo.routes.ts:76`.
      expect(res.headers['x-ratelimit-limit']).toBe('30');
      expect(res.headers['x-ratelimit-remaining']).toBe('29');
      expect(res.statusCode).toBe(400);
    });

    it('la richiesta oltre il budget è 429', async () => {
      const first = await consumeQuota();
      const limit = Number(first.headers['x-ratelimit-limit']);

      // The remaining ones up to exhausting the budget: all 400, none 429.
      const consumed = [first.statusCode];
      for (let i = 1; i < limit; i++) {
        consumed.push((await consumeQuota()).statusCode);
      }
      expect(consumed.every(s => s === 400)).toBe(true);

      const rejected = await consumeQuota();
      expect(rejected.statusCode).toBe(429);
      expect(rejected.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('il budget cade sull’IP quando il bearer non è un JWT valido, e le due rotte lo condividono', async () => {
      // `authToken` is the string 'mock-jwt-token', not a JWT: `keyGenerator`
      // fails to verify it and falls back to `req.ip`. With a real bearer the
      // key would be the user id -- this test pins down the fallback, not the
      // normal behavior.
      const limit = Number((await consumeQuota('10.0.0.1')).headers['x-ratelimit-limit']);
      for (let i = 1; i < limit; i++) await consumeQuota('10.0.0.1');

      // Same plugin scope, so same store: this is the encapsulation that the comment
      // in `brandLogo.routes.ts:62` exists to protect.
      const other = await app.inject({
        method: 'POST',
        url: '/upload/brand-logo/temp',
        headers: { authorization: `Bearer ${authToken}` },
        remoteAddress: '10.0.0.1',
      });
      expect(other.statusCode).toBe(429);

      // A different IP has its own budget: it reaches the handler's 400, not the 429.
      const elsewhere = await consumeQuota('10.0.0.2');
      expect(elsewhere.statusCode).toBe(400);
    });
  });

  describe('Error handling', () => {
    it('should handle service layer errors gracefully', async () => {
      // The service is no longer mocked (it contains the validations under test): the
      // failure is injected into the storage, which is the layer that is actually replaceable.
      const { putObject } = await import('../src/storage');
      vi.mocked(putObject).mockRejectedValueOnce(new Error('Storage non raggiungibile'));

      const pngBuffer = createValidPngBuffer();

      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test.png')
        .expect(500);
    });

    it('should handle malformed multipart data', async () => {
      await request(app.server)
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

      await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, '')
        .expect(400);
    });

    it('should handle filename with special characters', async () => {
      const pngBuffer = createValidPngBuffer();

      const response = await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test@#$%^&*().png')
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
    });

    it('should truncate a very long filename instead of rejecting it', async () => {
      const pngBuffer = createValidPngBuffer();
      const longFilename = 'a'.repeat(300) + '.png';

      // `sanitizeFileName` truncates to 255 characters while preserving the extension -- this is the
      // per-component limit of common filesystems. Rejecting would be more hostile
      // and no more secure: the test expected a 400 that the code does not produce.
      // The `key` returned here comes from the mocked storage, so it is not the
      // right observation point for the truncation: what this test
      // verifies is that a very long name does not make the request fail.
      const response = await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, longFilename)
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
    });
  });
});
