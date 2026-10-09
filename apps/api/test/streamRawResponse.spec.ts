/**
 * A streamed download over real HTTP: a client that goes away stops the source without being
 * reported as a server error, and a source that fails or ends early is reported (#87).
 */

import { once } from 'events';
import { Agent, get, type IncomingMessage } from 'http';
import { PassThrough, Writable, type Readable } from 'stream';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { registerBackupExportDownloadRoute } from '../src/routes/backupExportDownload';
import { getStorageProvider } from '../src/storage';
import { signExportToken } from '../src/utils/downloadToken';
import { streamRawResponse } from '../src/utils/streamResponse';

vi.mock('../src/storage', () => ({ getStorageProvider: vi.fn() }));

let app: FastifyInstance;
afterEach(() => app.close());

/** Serves `GET /download` from the source `next()` returns, reporting failures to `onError`. */
async function serve(next: () => Readable, onError: (err: unknown) => void): Promise<string> {
  app = Fastify();
  app.get('/download', async (_request, reply) => {
    streamRawResponse(reply, next(), { 'Content-Type': 'application/octet-stream' }, onError);
  });
  return app.listen({ port: 0, host: '127.0.0.1' });
}

function request(url: string, agent?: Agent): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => get(url, { agent }, response => {
    response.on('error', () => {}); // a response cut short errors with `aborted`: expected here
    resolve(response);
  }).on('error', reject));
}

/** Resolves on `close`; unlike `events.once`, not rejected by the `error` a destroyed stream emits. */
const closed = (stream: NodeJS.EventEmitter) => new Promise(resolve => stream.once('close', resolve));

/** Resolves once the event loop has had a turn to run the handlers queued by a close. */
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('streamRawResponse', () => {
  it('serves the whole source, twice on one kept-alive connection', async () => {
    const onError = vi.fn();
    const url = await serve(() => {
      const source = new PassThrough();
      source.end('payload');
      return source;
    }, onError);
    const agent = new Agent({ keepAlive: true });

    for (let i = 0; i < 2; i++) {
      const response = await request(`${url}/download`, agent);
      const chunks: Buffer[] = [];
      for await (const chunk of response) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('payload');
    }
    agent.destroy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops the source when the client goes away, without reporting an error', async () => {
    const onError = vi.fn();
    const source = new PassThrough();
    const url = await serve(() => source, onError);

    source.write('first chunk');
    const response = await request(`${url}/download`);
    await once(response, 'data');
    response.destroy();
    await closed(source);
    await settle();

    expect(source.destroyed).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a source that fails, and one that ends early', async () => {
    const onError = vi.fn();
    const sources = [new PassThrough(), new PassThrough()];
    const url = await serve(() => sources.shift()!, onError);

    for (const end of [(s: PassThrough) => s.destroy(new Error('read failed')), (s: PassThrough) => s.destroy()]) {
      const source = sources[0]!;
      source.write('first chunk');
      const response = await request(`${url}/download`);
      await once(response, 'data');
      end(source);
      await closed(response);
      await settle();
    }

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]![0]).toMatchObject({ message: 'read failed' });
    expect(onError.mock.calls[1]![0]).toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
  });
});

describe('streamRawResponse, response still sending', () => {
  it('does not report a client that leaves after the source has ended', async () => {
    const onError = vi.fn();
    // A response whose writes never complete: the source ends while the response is still sending.
    const raw = Object.assign(new Writable({ write: () => {} }), { writeHead: () => {} });
    const reply = { hijack: () => {}, raw } as unknown as FastifyReply; // the two members it uses
    const source = new PassThrough();
    source.end('payload');

    streamRawResponse(reply, source, {}, onError);
    await once(source, 'end');
    raw.destroy(); // the client goes away
    await closed(raw);
    await settle();

    expect(onError).not.toHaveBeenCalled();
  });
});

describe('/download/backup/:id/export', () => {
  it('closes the storage stream when the client goes away', async () => {
    const stored = new PassThrough();
    stored.write('encrypted body');
    vi.mocked(getStorageProvider).mockResolvedValue({
      get: async () => ({ stream: stored }),
    } as unknown as Awaited<ReturnType<typeof getStorageProvider>>);
    const backupId = '00000000-0000-4000-8000-000000000001';
    // Only the lookup the route makes; the rest of the client is never touched.
    const prisma = {
      backupRecord: { findUnique: async () => ({ id: backupId, status: 'COMPLETED', filename: 'blob.bin' }) },
    } as unknown as PrismaClient;
    const token = signExportToken({
      bucket: 'backups',
      key: 'blob.bin',
      header: {
        version: 1, backupId, scope: 'DB', algorithm: 'aes-256-gcm', kdf: 'argon2id',
        passphraseWrapped: { saltHex: '', ivHex: '', authTagHex: '', ciphertextHex: '' },
        bodyIvHex: '', bodyAuthTagHex: '', checksumSha256: '', sizeBytesEncrypted: '0',
        appVersion: null, schemaMigrationName: null, createdAt: new Date().toISOString(),
      },
    });
    app = Fastify();
    await registerBackupExportDownloadRoute(app, prisma);
    const url = await app.listen({ port: 0, host: '127.0.0.1' });

    const response = await request(`${url}/download/backup/${backupId}/export?token=${encodeURIComponent(token)}`);
    await once(response, 'data');
    response.destroy();
    await closed(stored);

    expect(stored.destroyed).toBe(true);
  });
});
