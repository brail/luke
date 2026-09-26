/**
 * What a client reads in a tRPC error body, per environment.
 *
 * A 4xx carries text written for the caller and passes everywhere; a 5xx can carry internals and
 * is masked in production; a failed input parse shows the first Zod issue instead of the JSON
 * dump of all of them. Production used to mask every message, 4xx included, so the web showed
 * "Internal server error" for every unmapped refusal — and `ChangePasswordCard`, which branches on
 * `Password corrente non valida`, logged out a user who mistyped their current password.
 *
 * The router is built on the real `t` and served through the fetch adapter, so these assertions
 * read the body a client receives, including tRPC's own wrapping of a failed input parse.
 */

import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BrandInputSchema } from '@luke/core';

import type { Context } from '../src/lib/context';
import type { AnyTRPCRouter } from '@trpc/server';

const CLIENT_ERRORS = [
  ['BAD_REQUEST', 'Il campo non è valido'],
  // The text `ChangePasswordCard` compares against (apps/api/src/routers/me.ts).
  ['UNAUTHORIZED', 'Password corrente non valida'],
  ['FORBIDDEN', 'Cambio password non consentito per provider esterni'],
  ['NOT_FOUND', 'Brand non trovato'],
  ['CONFLICT', 'Email già in uso'],
  ['PRECONDITION_FAILED', 'Impossibile eliminare: il brand è usato in 2 collection layout'],
] as const;

/**
 * Builds a router on the real `t`, loaded fresh: `error.ts` reads `NODE_ENV` once, at module load.
 */
async function loadRouter(nodeEnv: 'production' | 'development'): Promise<AnyTRPCRouter> {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.resetModules();
  const { t } = await import('../src/lib/t');
  const { buildRateLimitExceededError } = await import('../src/lib/rateLimitError');

  const failWith = (err: Error) =>
    t.procedure.query(() => {
      throw err;
    });

  return t.router({
    ...Object.fromEntries(
      CLIENT_ERRORS.map(([code, message]) => [code, failWith(new TRPCError({ code, message }))])
    ),
    internal: failWith(
      new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Bind LDAP fallito: 10.0.0.5:389' })
    ),
    unexpected: failWith(new Error('connect ECONNREFUSED 10.0.0.5:5432')),
    unavailable: failWith(
      new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Sistema in manutenzione. Riprova più tardi.' })
    ),
    rateLimited: failWith(buildRateLimitExceededError('login', { max: 5, windowMs: 60_000 })),
    explicitWithZodCause: failWith(
      new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Configurazione non valida',
        cause: z.string().safeParse(1).error,
      })
    ),
    localSchema: t.procedure
      .input(z.object({ name: z.string().min(1, 'Nome obbligatorio') }))
      .query(() => 'ok'),
    coreSchema: t.procedure.input(BrandInputSchema).query(() => 'ok'),
    invalidOutput: t.procedure
      .output(z.object({ n: z.number() }))
      // Deliberately breaks the declared output schema: that is the failure under test.
      .query(() => ({ n: 'not a number' }) as unknown as { n: number }),
  });
}

async function callError(router: AnyTRPCRouter, path: string, input?: unknown) {
  const url = new URL(`http://luke.test/trpc/${path}`);
  if (input !== undefined) url.searchParams.set('input', JSON.stringify(input));
  const response = await fetchRequestHandler({
    endpoint: '/trpc',
    req: new Request(url),
    router,
    // No procedure under test reads the context.
    createContext: async () => ({}) as Context,
  });
  const body = await response.json();
  return body.error;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('trpcErrorFormatter in production', () => {
  it.each(CLIENT_ERRORS)('keeps the message of a %s', async (code, message) => {
    const router = await loadRouter('production');

    const error = await callError(router, code);

    expect(error.data.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it('masks an INTERNAL_SERVER_ERROR', async () => {
    const error = await callError(await loadRouter('production'), 'internal');

    expect(error.message).toBe('Internal server error');
  });

  it('masks an error the resolver did not expect', async () => {
    const error = await callError(await loadRouter('production'), 'unexpected');

    expect(error.data.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe('Internal server error');
    expect(JSON.stringify(error)).not.toContain('ECONNREFUSED');
  });

  it('masks every 5xx, not only INTERNAL_SERVER_ERROR', async () => {
    const error = await callError(await loadRouter('production'), 'unavailable');

    expect(error.data.httpStatus).toBe(503);
    expect(error.message).toBe('Internal server error');
  });

  it('shows the Zod issue of a failed input parse, not the JSON dump', async () => {
    const error = await callError(await loadRouter('production'), 'localSchema', { name: '' });

    expect(error.data.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('Nome obbligatorio');
  });

  it('shows the first of several issues from a @luke/core schema', async () => {
    const error = await callError(await loadRouter('production'), 'coreSchema', { code: '', name: '' });

    expect(error.message).toBe('Codice obbligatorio');
  });

  it('keeps an explicit message even when the cause is a ZodError', async () => {
    const error = await callError(await loadRouter('production'), 'explicitWithZodCause');

    expect(error.message).toBe('Configurazione non valida');
  });

  it('masks an output that breaks its schema', async () => {
    const error = await callError(await loadRouter('production'), 'invalidOutput');

    expect(error.data.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).toBe('Internal server error');
  });

  it('keeps retryAfterSeconds on a rate-limit error', async () => {
    const error = await callError(await loadRouter('production'), 'rateLimited');

    expect(error.data.code).toBe('TOO_MANY_REQUESTS');
    expect(error.data.retryAfterSeconds).toBe(60);
  });

  it('sends no stack', async () => {
    const error = await callError(await loadRouter('production'), 'internal');

    expect(error.data.stack).toBeUndefined();
  });
});

describe('trpcErrorFormatter in development', () => {
  it('shows a 5xx message in clear', async () => {
    const error = await callError(await loadRouter('development'), 'internal');

    expect(error.message).toBe('Bind LDAP fallito: 10.0.0.5:389');
  });

  it('shows the Zod issue of a failed input parse, as production does', async () => {
    const error = await callError(await loadRouter('development'), 'localSchema', { name: '' });

    expect(error.message).toBe('Nome obbligatorio');
  });
});
