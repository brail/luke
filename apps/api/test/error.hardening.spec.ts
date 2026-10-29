import { TRPCError } from '@trpc/server';
import Fastify from 'fastify';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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

  it('responds 500 with a safe body and does not crash', async () => {
    const res = await app.inject({ method: 'GET', url: '/__boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toMatchObject({ error: true, code: 'INTERNAL_SERVER_ERROR' });
    expect(typeof body.traceId === 'string' || body.traceId === undefined).toBe(
      true
    );
  });
});

/**
 * A `TRPCError` that reaches Fastify's handler (a REST route that lets it through) answers with its
 * own status, as the tRPC adapter would; a 4xx keeps its message in production, a 5xx does not.
 */
describe('the global error handler on a tRPC error', () => {
  async function appThrowing(error: TRPCError, handler = setGlobalErrorHandler) {
    const app = Fastify({ logger: false });
    handler(app);
    app.get('/__trpc', async () => {
      throw error;
    });
    await app.ready();
    return app;
  }

  it('answers each code with its own status and message', async () => {
    for (const [code, status] of [['TOO_MANY_REQUESTS', 429], ['PRECONDITION_FAILED', 412]] as const) {
      const app = await appThrowing(new TRPCError({ code, message: `refused-${code}` }));
      const res = await app.inject({ method: 'GET', url: '/__trpc' });
      await app.close();

      expect(res.statusCode).toBe(status);
      expect(res.json()).toMatchObject({ code, message: `refused-${code}` });
    }
  });

  it('keeps a 4xx message in production and masks a 5xx one', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    try {
      // The module reads the environment once, when it loads.
      const { setGlobalErrorHandler: productionHandler } = await import('../src/lib/error');
      const refused = await appThrowing(new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Configura prima lo storage' }), productionHandler);
      const failed = await appThrowing(new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'secret-host:5432 refused' }), productionHandler);

      const refusedBody = (await refused.inject({ method: 'GET', url: '/__trpc' })).json();
      const failedRes = await failed.inject({ method: 'GET', url: '/__trpc' });
      await refused.close();
      await failed.close();

      expect(refusedBody).toMatchObject({ message: 'Configura prima lo storage' });
      expect(failedRes.statusCode).toBe(500);
      expect(failedRes.body).not.toContain('secret-host');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
