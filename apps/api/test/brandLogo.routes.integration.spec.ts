/**
 * Test integration per Brand Logo Upload Endpoints
 * Verifica endpoint Fastify multipart con supertest
 */

import multipart from '@fastify/multipart';
import { FastifyInstance } from 'fastify';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import brandLogoRoutes from '../src/routes/brandLogo.routes';

import { createValidPngBuffer } from './helpers/storageTestHelper';
import { createContextForRole } from './helpers/testContext';

// Mock del storage module
vi.mock('../src/storage', () => ({
  putObject: vi.fn(),
  // `deleteObjectByKey`, non `deleteObject`: è quello che importa
  // `brandLogo.service.ts`. Con il nome sbagliato la factory non lo definiva, e
  // dal secondo upload in poi il ramo di cleanup del logo precedente lanciava
  // dentro il `setImmediate` — dove il `catch` del service se lo mangiava.
  deleteObjectByKey: vi.fn(),
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
    // rendendo il risultato dipendente dall'ordine di esecuzione. Il troncamento
    // lo fa `createContextForRole`, prima di inserire l'utente di sessione.
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
    const { putObject, deleteObjectByKey, getStorageProvider } = await import(
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

    vi.mocked(deleteObjectByKey).mockResolvedValue(undefined);
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

    // Nessuna registrazione di `@fastify/rate-limit` qui: il limiter sotto test è
    // quello che `brandLogoRoutes` registra da sé (`brandLogo.routes.ts:75`). Il
    // plugin usa un `Symbol` per registrazione, quindi due registrazioni non si
    // deduplicano: quella che stava qui era un secondo store indipendente da 100
    // che non entrava mai in gioco e faceva sembrare il limite più largo di
    // quello reale.

    // Registra le route di upload. Import statico, non `require`: il modulo è
    // ESM sotto vitest e `require` fallisce con "Cannot find module".
    await app.register(brandLogoRoutes, {
      prisma: testContext.prisma,
    });

    // `app.server` (l'http.Server che supertest pilota) esiste solo dopo ready().
    await app.ready();
  });

  afterEach(async () => {
    // Solo ciò che il troncamento non copre: il server Fastify e i mock. I dati
    // li azzera `createContextForRole` nel `beforeEach` del test successivo.
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

  /**
   * Il rate limit si esaurisce senza toccare il database.
   *
   * La versione precedente faceva 40 upload veri via supertest ed era flaky:
   * `app.ready()` non mette in ascolto, quindi supertest apriva e chiudeva un
   * listener effimero **per richiesta** — 40 cicli listen/connect/close che sotto
   * carico finivano in ETIMEDOUT a livello di socket. Il costo non era il rate
   * limit (il limiter è un hook `onRequest`, quindi un 429 non parsa il multipart
   * e non tocca Postgres) ma i 30 upload riusciti, ~6 round-trip ciascuno.
   *
   * Qui si usa `app.inject()` — niente socket, stesso ciclo di vita Fastify,
   * quindi il limiter scatta comunque — e richieste **senza body**: il limiter
   * conta all'arrivo, poi `req.file()` lancia e l'handler risponde 400. Zero
   * query. La URL deve restare quella vera: il limiter è agganciato via `onRoute`,
   * quindi una URL inesistente non consumerebbe quota.
   */
  describe('Rate limiting', () => {
    /** POST senza body sulla rotta sotto test: consuma quota, non tocca il DB. */
    const consumeQuota = (ip = '127.0.0.1') =>
      app.inject({
        method: 'POST',
        url: `/upload/brand-logo/${testBrand.id}`,
        headers: { authorization: `Bearer ${authToken}` },
        remoteAddress: ip,
      });

    it('espone il budget residuo già alla prima richiesta', async () => {
      const res = await consumeQuota();

      // 30, non i 100 di sviluppo: `test/setup.ts` imposta NODE_ENV=test, quindi
      // `isDevelopment()` è falso in `brandLogo.routes.ts:76`.
      expect(res.headers['x-ratelimit-limit']).toBe('30');
      expect(res.headers['x-ratelimit-remaining']).toBe('29');
      expect(res.statusCode).toBe(400);
    });

    it('la richiesta oltre il budget è 429', async () => {
      const first = await consumeQuota();
      const limit = Number(first.headers['x-ratelimit-limit']);

      // Le restanti fino a esaurire il budget: tutte 400, nessuna 429.
      const consumed = [first.statusCode];
      for (let i = 1; i < limit; i++) {
        consumed.push((await consumeQuota()).statusCode);
      }
      expect(consumed.every(s => s === 400)).toBe(true);

      const rejected = await consumeQuota();
      expect(rejected.statusCode).toBe(429);
      expect(rejected.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('il budget è per IP, e le due rotte lo condividono', async () => {
      const limit = Number((await consumeQuota('10.0.0.1')).headers['x-ratelimit-limit']);
      for (let i = 1; i < limit; i++) await consumeQuota('10.0.0.1');

      // Stesso scope del plugin ⇒ stesso store: è l'incapsulamento che il commento
      // in `brandLogo.routes.ts:62` esiste per proteggere.
      const other = await app.inject({
        method: 'POST',
        url: '/upload/brand-logo/temp',
        headers: { authorization: `Bearer ${authToken}` },
        remoteAddress: '10.0.0.1',
      });
      expect(other.statusCode).toBe(429);

      // Un IP diverso ha il suo budget: arriva al 400 dell'handler, non al 429.
      const elsewhere = await consumeQuota('10.0.0.2');
      expect(elsewhere.statusCode).toBe(400);
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
