/**
 * What an error log line carries. Every API logger is a child of one root (`lib/logger.ts`): pino's
 * standard `err` serializer keeps an error's message, stack and cause, and the root's `redact` drops
 * credentials wherever the documented paths reach — the top level, two levels down and two levels
 * inside the error itself.
 */

import { Writable } from 'node:stream';

import Fastify, { type FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { describe, it, expect } from 'vitest';

import { setGlobalErrorHandler } from '../src/lib/error';
import { loggerOptions } from '../src/lib/logger';

/** The fields a test reads from a JSON log line. */
interface LogLine {
  msg?: string;
  err?: { message?: string; stack?: string };
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
