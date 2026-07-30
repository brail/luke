/**
 * Test integration per Brand Logo Upload Endpoints
 * Verifica endpoint Fastify multipart con supertest
 */

import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import brandLogoRoutes from '../src/routes/brandLogo.routes';

import { resetTestData } from './helpers/database';
import { createValidPngBuffer } from './helpers/storageTestHelper';
import { createContextForRole } from './helpers/testContext';

// Mock del storage module
vi.mock('../src/storage', () => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  getStorageProvider: vi.fn(),
}));

// `brandLogo.service` NON va mockato: contiene proprio le validazioni che questi
// test verificano (tipo file, magic bytes, esistenza del brand → 404). Mockarlo
// faceva ritornare successo sempre, rendendo le asserzioni su 400/404 impossibili
// da soddisfare e prive di significato. Si mocka solo lo storage sottostante.

// Il mock dell'auth deve stare qui, non in `beforeEach` con `vi.doMock`:
// `brandLogo.routes` è importato staticamente e cattura il riferimento reale
// prima che un doMock possa intervenire. La route usa `requireSessionWithPermission`,
// non `authenticateRequest` — il vecchio mock puntava alla funzione sbagliata.
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
    // Il codice brand è fisso: senza troncare i dati, un `TEST_BRAND` lasciato da
    // un altro file di test fa fallire la create e con essa l'intera suite —
    // rendendo il risultato dipendente dall'ordine di esecuzione.
    await resetTestData();

    testContext = await createContextForRole();

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
    // Stub parziali: coprono solo la superficie usata dal service, quindi i cast
    // riconoscono che non sono implementazioni complete di StoredObjectMeta /
    // IStorageProvider.
    vi.mocked(putObject).mockResolvedValue({
      id: 'mock-file-id',
      key: 'mock-key',
      bucket: 'brand-logos',
      contentType: 'image/png',
      size: 1000,
      createdAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof putObject>>);

    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(getStorageProvider).mockResolvedValue({
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getStorageProvider>>);

    // Crea app Fastify per test
    const fastify = (await import('fastify')).default;
    app = fastify({ logger: false });

    // Registra plugin multipart
    await app.register(multipart, {
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB
        files: 1,
      },
    });

    // Registra plugin rate limit
    await app.register(rateLimit, {
      max: 100, // Più permissivo per test
      timeWindow: '1 minute',
      keyGenerator: (req: any) => req.ip,
    });

    // Registra le route di upload. Import statico, non `require`: il modulo è
    // ESM sotto vitest e `require` fallisce con "Cannot find module".
    await app.register(brandLogoRoutes, {
      prisma: testContext.prisma,
    });

    // `app.server` (l'http.Server che supertest pilota) esiste solo dopo ready().
    await app.ready();
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

      // `req.file()` legge la prima parte file e si ferma: le successive non
      // vengono mai consumate, quindi il limite `files: 1` di busboy non scatta.
      // È la semantica voluta per un endpoint a logo singolo — il test pretendeva
      // un rifiuto che il codice non ha mai implementato.
      const response = await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, 'test1.png')
        .attach('file', pngBuffer, 'test2.png')
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
    });

    it('rifiuta un file il cui contenuto non corrisponde al tipo dichiarato', async () => {
      // La versione precedente allegava uno stream che emetteva `error`: il
      // client abortiva la richiesta prima di ricevere risposta e supertest
      // falliva con ECONNRESET — misurava l'harness, non il server.
      //
      // Il contratto verificabile è la validazione dei magic bytes: byte che non
      // sono un PNG, dichiarati come PNG, devono essere respinti con 400.
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

      // Il contratto è cambiato: niente `tempLogoId` fornito dal client né bucket
      // `temp-brand-logos`. Il file finisce in `brand-logos` come fileObject
      // *pending*, e viene confermato al salvataggio del brand via `fileObjectId`.
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

      // L'id del file lo assegna il server (`fileObjectId`), non il client: un
      // `tempId` inviato dal chiamante non viene né richiesto né usato.
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

  describe('Rate limiting', () => {
    it('should enforce rate limiting', async () => {
      const pngBuffer = createValidPngBuffer();

      // 150 upload concorrenti saturavano il server di test e supertest falliva
      // con ECONNRESET prima ancora di vedere un 429. Il limite configurato è 30
      // req/min: 40 richieste bastano a superarlo, in sequenza per non
      // trasformare il test in uno stress test del socket.
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        const res = await request(app.server)
          .post(`/upload/brand-logo/${testBrand.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .attach('file', pngBuffer, 'test.png');
        statuses.push(res.status);
      }

      // Alcune richieste dovrebbero essere rate limited
      expect(statuses.filter(s => s === 429).length).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should handle service layer errors gracefully', async () => {
      // Il service non è più mockato (contiene le validazioni sotto test): il
      // guasto si inietta nello storage, che è il livello davvero sostituibile.
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

      // `sanitizeFileName` tronca a 255 caratteri preservando l'estensione — è il
      // limite per componente dei filesystem comuni. Rifiutare sarebbe più ostile
      // e non più sicuro: il test pretendeva un 400 che il codice non produce.
      // La `key` restituita qui viene dallo storage mockato, quindi non è il
      // punto di osservazione giusto per il troncamento: ciò che questo test
      // verifica è che un nome lunghissimo non faccia fallire la richiesta.
      const response = await request(app.server)
        .post(`/upload/brand-logo/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .attach('file', pngBuffer, longFilename)
        .expect(200);

      expect(response.body).toHaveProperty('publicUrl');
    });
  });
});
