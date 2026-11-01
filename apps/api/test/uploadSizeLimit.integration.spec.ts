/**
 * Upload routes enforce their limits while the body streams in, so an oversized or malformed
 * request is refused before the service runs. Limits are per kind of asset, and the backup import
 * keeps its own: it streams a file far larger than any image, with its fields before it.
 */

import { Readable } from 'stream';

import multipart from '@fastify/multipart';
import fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_KINDS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import * as auditLog from '../src/lib/auditLog';
import * as importPipeline from '../src/lib/backup/importPipeline';
import { MULTIPART_GLOBAL_LIMITS } from '../src/lib/multipartUpload';
import { registerBackupImportRoute } from '../src/routes/backupImport';
import brandLogoRoutes from '../src/routes/brandLogo.routes';
import collectionRowPictureRoutes from '../src/routes/collectionRowPicture.routes';
import companyLogoRoutes from '../src/routes/companyLogo.routes';
import specsheetImageRoutes from '../src/routes/specsheetImage.routes';
import * as brandLogo from '../src/services/brandLogo.service';
import * as rowPicture from '../src/services/collectionRowPicture.service';
import * as companyLogo from '../src/services/companyLogo.service';
import * as specsheetImage from '../src/services/specsheetImage.service';

import { multipartRequest, pngPart, type MultipartPart } from './helpers/multipart';

vi.mock('../src/lib/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  requireSessionWithPermission: vi.fn(async () => ({ user: { id: 'u1', role: 'admin' } })),
}));

const MIB = 1024 * 1024;
const ID = '00000000-0000-4000-8000-000000000001';

let app: FastifyInstance;
const services = {
  rowTemp: vi.spyOn(rowPicture, 'uploadTempCollectionRowPicture'),
  row: vi.spyOn(rowPicture, 'uploadCollectionRowPicture'),
  brand: vi.spyOn(brandLogo, 'uploadBrandLogo'),
  brandTemp: vi.spyOn(brandLogo, 'uploadTempBrandLogo'),
  company: vi.spyOn(companyLogo, 'uploadCompanyLogo'),
  specsheet: vi.spyOn(specsheetImage, 'uploadSpecsheetImage'),
};

/** The size of the file handed to the service, on its first call. */
function sizeOf(service: { mock: { calls: unknown[][] } }) {
  return (service.mock.calls[0]?.[1] as { file: { size: number } }).file.size;
}

beforeAll(async () => {
  app = fastify({ logger: false });
  await app.register(multipart, { limits: MULTIPART_GLOBAL_LIMITS });
  // No route under test reaches the database: auth and the services are replaced.
  const prisma = {} as PrismaClient;
  await app.register(brandLogoRoutes, { prisma });
  await app.register(companyLogoRoutes, { prisma });
  await app.register(collectionRowPictureRoutes, { prisma });
  await app.register(specsheetImageRoutes, { prisma });
  await registerBackupImportRoute(app, prisma);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  for (const service of Object.values(services)) {
    service.mockReset();
    // The routes send what the service returns, whatever its type.
    service.mockResolvedValue({ ok: true } as never);
  }
});

const png = (size: number, filename = 'a.png') => pngPart(filename, Buffer.alloc(size));

async function post(url: string, parts: MultipartPart[]) {
  const { payload, headers } = await multipartRequest(parts);
  return app.inject({ method: 'POST', url, payload, headers });
}

const singleFileRoutes = [
  { name: 'row picture, temp', url: '/upload/collection-row-picture/temp', max: ASSET_KINDS['collection-row-picture'].maxSizeBytes, service: services.rowTemp },
  { name: 'row picture', url: `/upload/collection-row-picture/${ID}`, max: ASSET_KINDS['collection-row-picture'].maxSizeBytes, service: services.row },
  { name: 'brand logo', url: `/upload/brand-logo/${ID}`, max: ASSET_KINDS['brand-logo'].maxSizeBytes, service: services.brand },
  { name: 'company logo', url: '/upload/company-logo', max: ASSET_KINDS['company-asset'].maxSizeBytes, service: services.company },
];

const allRoutes = [
  ...singleFileRoutes,
  { name: 'brand logo, temp', url: '/upload/brand-logo/temp', max: ASSET_KINDS['brand-logo'].maxSizeBytes, service: services.brandTemp },
  { name: 'specsheet image', url: `/upload/specsheet-image/${ID}`, max: ASSET_KINDS['specsheet-image'].maxSizeBytes, service: services.specsheet },
];

describe.each(allRoutes)('$name, size', ({ url, max, service }) => {
  it('accepts a file at the limit', async () => {
    const res = await post(url, [png(max)]);

    expect(res.statusCode).toBe(200);
    expect(sizeOf(service)).toBe(max);
  });

  it('refuses one byte over the limit with 413, without calling the service', async () => {
    const res = await post(url, [png(max + 1)]);

    expect(res.statusCode).toBe(413);
    expect(res.json().message).toBe(`File troppo grande. Max ${max / MIB}MB`);
    expect(service).not.toHaveBeenCalled();
  });
});

describe.each(singleFileRoutes)('$name', ({ url, service }) => {
  it('refuses a field before the file', async () => {
    const res = await post(url, [{ name: 'extra', value: 'x' }, png(10)]);

    expect(res.statusCode).toBe(400);
    expect(service).not.toHaveBeenCalled();
  });

  it('processes only the first file when a field or a second file follows it', async () => {
    for (const extra of [{ name: 'extra', value: 'x' }, png(20, 'b.png')]) {
      service.mockClear();
      const res = await post(url, [png(10), extra]);

      expect(res.statusCode).toBe(200);
      expect(service).toHaveBeenCalledOnce();
      expect(sizeOf(service)).toBe(10);
    }
  });
});

describe('brand logo, temp', () => {
  const url = '/upload/brand-logo/temp';

  it.each<[string, MultipartPart[]]>([
    ['a field before the file', [{ name: 'extra', value: 'x' }, png(10)]],
    ['a field after the file', [png(10), { name: 'extra', value: 'x' }]],
    ['a second file', [png(10), png(10, 'b.png')]],
  ])('refuses %s', async (_what, parts) => {
    expect((await post(url, parts)).statusCode).toBe(400);
    expect(services.brandTemp).not.toHaveBeenCalled();
  });
});

describe('specsheet image', () => {
  const url = `/upload/specsheet-image/${ID}`;
  const caption = (value = 'Vista frontale') => ({ name: 'caption', value });

  it.each<[string, MultipartPart[]]>([
    ['before', [caption(), png(10)]],
    ['after', [png(10), caption()]],
  ])('takes a caption %s the file', async (_where, parts) => {
    expect((await post(url, parts)).statusCode).toBe(200);
    expect(services.specsheet.mock.calls[0]?.[1]).toMatchObject({ caption: 'Vista frontale' });
  });

  it('takes a caption at its limit', async () => {
    expect((await post(url, [caption('x'.repeat(2048)), png(10)])).statusCode).toBe(200);
  });

  it('refuses a caption over its limit with 413, not a truncated one', async () => {
    expect((await post(url, [caption('x'.repeat(2049)), png(10)])).statusCode).toBe(413);
    expect(services.specsheet).not.toHaveBeenCalled();
  });

  it.each<[string, MultipartPart[]]>([
    ['a second field', [caption(), { name: 'extra', value: 'x' }, png(10)]],
    ['a repeated caption', [caption(), caption(), png(10)]],
    ['a second file', [png(10), png(10, 'b.png')]],
  ])('refuses %s', async (_what, parts) => {
    expect((await post(url, parts)).statusCode).toBe(400);
    expect(services.specsheet).not.toHaveBeenCalled();
  });
});

describe('backup import', () => {
  const boundary = 'streamed-boundary';
  const size = MULTIPART_GLOBAL_LIMITS.fileSize + MIB;
  const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

  /** A body in many chunks, in the web client's order: the fields, then a file over any image limit. */
  async function* body(onChunk = () => {}) {
    yield Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="passphrase"\r\n\r\ncorrect-horse-battery-staple\r\n`);
    yield Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="label"\r\n\r\nprova\r\n`);
    yield Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="a.lukebak"\r\ncontent-type: application/octet-stream\r\n\r\n`);
    const chunk = Buffer.alloc(MIB);
    for (let sent = 0; sent < size; sent += MIB) {
      onChunk();
      yield chunk;
    }
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  }

  it('streams the file with its fields already read', async () => {
    const audit = vi.spyOn(auditLog, 'logAudit').mockResolvedValue(undefined as never);
    let received = 0;
    const job = vi.spyOn(importPipeline, 'runImportJob').mockImplementation(async ({ fileStream }) => {
      for await (const chunk of fileStream) received += (chunk as Buffer).length;
      return { id: 'b1', scope: 'full' } as never;
    });

    const res = await app.inject({ method: 'POST', url: '/upload/backup-import', payload: Readable.from(body()), headers });

    expect(res.statusCode, res.body).toBe(200);
    expect(received).toBe(size);
    expect(job.mock.calls[0]?.[0]).toMatchObject({ passphrase: 'correct-horse-battery-staple', label: 'prova' });
    job.mockRestore();
    audit.mockRestore();
  });

  it('reads the whole body after refusing the package, so the sender does not stall', async () => {
    let chunks = 0;

    const res = await app.inject({ method: 'POST', url: '/upload/backup-import', payload: Readable.from(body(() => { chunks++; })), headers });

    expect(res.statusCode, res.body).toBe(400);
    await vi.waitFor(() => expect(chunks).toBe(size / MIB));
  });
});
