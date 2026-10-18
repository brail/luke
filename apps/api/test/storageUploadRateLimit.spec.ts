import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { storagePlugin } from '../src/plugins/storageUpload';

/**
 * File serving stays out of the global per-IP limiter. Every picture of a collection layout is one
 * `GET /uploads/...`: counted, a hard reload of a photo-heavy layout spent the whole budget and
 * every other request from that browser got 429 (rc.1). The opt-out is per route: the limiter
 * still applies to the rest of the API.
 */

const MAX = 3;

async function buildApp() {
  const app = Fastify();
  await app.register(rateLimit, { max: MAX, timeWindow: '1 minute' });
  // Never reached: `backups` is refused before the handler resolves a storage provider.
  await app.register(storagePlugin, { prisma: {} as PrismaClient });
  app.get('/sibling', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('GET /uploads and the global rate limiter', () => {
  it('never answers 429 to file requests', async () => {
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < MAX + 2; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/uploads/backups/file.png' })).statusCode);
    }

    expect(statuses).toEqual(Array(MAX + 2).fill(403));
    await app.close();
  });

  it('still limits the other routes', async () => {
    const app = await buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < MAX + 1; i++) {
      statuses.push((await app.inject({ method: 'GET', url: '/sibling' })).statusCode);
    }

    expect(statuses).toEqual([...Array(MAX).fill(200), 429]);
    await app.close();
  });
});
