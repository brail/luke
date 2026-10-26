/**
 * What an error log line carries. Every API logger is a child of one root (`lib/logger.ts`): pino's
 * standard `err` serializer keeps an error's message, stack and cause, and the root's `redact` drops
 * credentials wherever the documented paths reach — the top level, two levels down and two levels
 * inside the error itself.
 */

import { Writable } from 'node:stream';

import { TRPCError } from '@trpc/server';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { describe, it, expect } from 'vitest';

import { logTrpcError, setGlobalErrorHandler } from '../src/lib/error';
import { loggerOptions } from '../src/lib/logger';

/** The fields a test reads from a JSON log line. */
interface LogLine {
  msg?: string;
  err?: { message?: string; stack?: string };
  cause?: string;
}

/** A pino logger with the API's options, writing its lines where the test can read them. */
function capture() {
  const lines: LogLine[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  // No transport: pino refuses one next to a destination stream, and development sets pino-pretty.
  return { logger: pino({ ...loggerOptions, transport: undefined, level: 'info' }, stream), lines };
}

describe('the root logger options', () => {
  it('keep the message, stack and cause of an error', () => {
    const { logger, lines } = capture();

    logger.error({ err: new Error('boom', { cause: new Error('the root cause') }) }, 'failed');

    // The standard serializer appends the causes to the message.
    expect(lines[0]?.err?.message).toBe('boom: the root cause');
    expect(lines[0]?.err?.stack).toEqual(expect.stringContaining('boom'));
  });

  it('drop credentials at the top level, two levels down and two levels inside the error', () => {
    const { logger, lines } = capture();
    const err = Object.assign(new Error('bind failed'), { bindDN: 'cn=svc-sentinel', password: 'pw-sentinel' });

    Object.assign(err, { config: { auth: { pass: 'deep-err-sentinel' } } });

    logger.error(
      { err, password: 'top-sentinel', config: { secret: 'nested-sentinel' }, smtp: { auth: { pass: 'deep-sentinel' } } },
      'failed',
    );

    const text = JSON.stringify(lines[0]);
    for (const sentinel of ['cn=svc-sentinel', 'pw-sentinel', 'top-sentinel', 'nested-sentinel', 'deep-sentinel', 'deep-err-sentinel']) {
      expect(text).not.toContain(sentinel);
    }
    expect(text).toContain('bind failed');
  });
});

describe('the global error handler', () => {
  it('logs the failure with its message and stack', async () => {
    const { logger, lines } = capture();
    // As `server.ts` passes it: typed as Fastify's base logger, so the instance stays a plain `FastifyInstance`.
    const fastifyLogger: FastifyBaseLogger = logger;
    const app = Fastify({ loggerInstance: fastifyLogger });
    setGlobalErrorHandler(app);
    app.get('/fail', async () => {
      throw new Error('kaput-sentinel');
    });

    await app.inject({ method: 'GET', url: '/fail' });
    await app.close();

    const failed = lines.find(line => line.msg === 'request failed');
    expect(failed?.err?.message).toBe('kaput-sentinel');
    expect(failed?.err?.stack).toEqual(expect.stringContaining('kaput-sentinel'));
  });
});

describe('the tRPC error line', () => {
  it('carries an internal error whole, with its stack and the cause set for it', () => {
    const { logger, lines } = capture();
    const error = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'failed', cause: new Error('root-cause-sentinel') });

    logTrpcError(logger, { path: 'brand.create', error, traceId: 'trace-1' });

    expect(lines[0]?.err?.message).toBe('failed: root-cause-sentinel');
    expect(lines[0]?.err?.stack).toEqual(expect.stringContaining('root-cause-sentinel'));
  });

  it("logs the exception itself, once, when tRPC wrapped it in its own message", () => {
    const { logger, lines } = capture();
    // What tRPC builds around an exception no procedure caught: the cause's message, no other.
    const error = new TRPCError({ code: 'INTERNAL_SERVER_ERROR', cause: new Error('uncaught-sentinel') });

    logTrpcError(logger, { path: 'brand.create', error });

    expect(lines[0]?.err?.message).toBe('uncaught-sentinel');
  });

  it('keeps a 4xx, or an expected 5xx, to its code and message under the same key, with no stack', () => {
    const { logger, lines } = capture();

    logTrpcError(logger, { path: 'seasonCalendar.updateMilestone', error: new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' }) });
    logTrpcError(logger, { path: 'brand.list', error: new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Manutenzione in corso' }) });

    expect(lines.map(line => line.err)).toMatchObject([
      { code: 'NOT_FOUND', message: 'Evento non trovato' },
      { code: 'SERVICE_UNAVAILABLE', message: 'Manutenzione in corso' },
    ]);
    expect(lines.every(line => !line.err?.stack)).toBe(true);
  });

  it('names a cause only when it says more than the message', () => {
    const { logger, lines } = capture();

    logTrpcError(logger, { path: 'brand.create', error: new TRPCError({ code: 'CONFLICT', message: 'Codice già usato', cause: new Error('Unique constraint failed') }) });
    logTrpcError(logger, { path: 'brand.list', error: new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Troppe richieste', cause: { retryAfterSeconds: 60 } }) });

    expect(lines.map(line => line.cause)).toEqual(['Unique constraint failed', undefined]);
  });
});
