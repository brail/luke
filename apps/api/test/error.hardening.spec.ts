import Fastify from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { setGlobalErrorHandler } from '../src/lib/error';

describe('API Hardening - error handler e process guards', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setGlobalErrorHandler(app);
    app.get('/__boom', async () => {
      throw new Error('boom');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('risponde 500 con body safe e non crasha', async () => {
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toMatchObject({ error: true, code: 'INTERNAL_SERVER_ERROR' });
    expect(typeof body.traceId === 'string' || body.traceId === undefined).toBe(
      true
    );
  });
});
