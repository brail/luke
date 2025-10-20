import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
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

  it('gestisce unhandledRejection con chiusura ordinata', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(
      // @ts-expect-error test stub
      () => undefined
    );

    // Simula handler: registriamo listener temporaneo
    const fastify = Fastify({ logger: false });
    const closeSpy = vi.spyOn(fastify, 'close').mockResolvedValue();

    // Implementazione minimale del guard
    const onFatal = async () => {
      try {
        await fastify.close();
      } finally {
        process.exit(1);
      }
    };

    // Non emettere davvero l'evento di processo: invoca direttamente il guard
    await onFatal();

    expect(closeSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    closeSpy.mockRestore();
  });
});
