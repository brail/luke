/**
 * The request-limit lanes name procedures by their dotted path (`@luke/core`): a renamed or removed
 * procedure would silently fall back to the normal lane, so every listed name must be mounted.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BACKGROUND_PROCEDURES, ESSENTIAL_PROCEDURES } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createToken, rateLimitKeyFromRequest } from '../src/lib/auth';
import { globalRateLimitOptions } from '../src/lib/globalRateLimit';
import * as jwtModule from '../src/lib/jwt';
import * as tokenVersionCache from '../src/lib/tokenVersionCache';

import { discoverProcedures } from './helpers/procedureRegistry';

import type { FastifyRequest } from 'fastify';

describe('request-limit lanes', () => {
  it('list only procedures the router mounts', () => {
    const mounted = new Set(discoverProcedures());
    for (const name of [...ESSENTIAL_PROCEDURES, ...BACKGROUND_PROCEDURES]) {
      expect(mounted.has(name), name).toBe(true);
    }
  });
});

describe('refusal log', () => {
  // A route with its own `config.rateLimit` (the season-calendar exports) inherits `onExceeded` with
  // its own keys, `u:<id>` and `ip:<address>`, which carry no lane.
  it.each([
    ['normal:u:user-1', { lane: 'normal', userId: 'user-1' }],
    ['u:user-1', { userId: 'user-1' }],
    ['ip:::1', { ip: '::1' }],
    ['ip:203.0.113.7', { ip: '203.0.113.7' }],
  ])('names the bucket of key %s', (key, named) => {
    const log = { warn: vi.fn() };
    const { onExceeded } = globalRateLimitOptions({} as PrismaClient, log); // never queried here
    const request = { url: '/trpc/none.such?input=1', method: 'GET', headers: {} } as unknown as FastifyRequest;

    onExceeded?.(request, key);

    expect(log.warn).toHaveBeenCalledWith(
      { ...named, traceId: undefined, method: 'GET', path: '/trpc', procedures: ['none.such'] },
      'Rate limit exceeded'
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A request to `url` from 203.0.113.7 carrying a signed bearer for user-7. */
function signedRequest(url = '/trpc/me.get') {
  const bearer = createToken(
    { id: 'user-7', email: 'u7@test.com', username: 'u7', role: 'viewer', tokenVersion: 0 },
    Math.floor(Date.now() / 1000)
  );
  // Only the fields the key generators read: a full Fastify request is not needed here.
  return { url, ip: '203.0.113.7', headers: { authorization: `Bearer ${bearer}` } } as unknown as FastifyRequest;
}

/** Verification fails as a server fault does: `verifyJWT` throws instead of refusing. */
function verificationFaults() {
  vi.spyOn(jwtModule, 'verifyJWT').mockImplementation(() => {
    throw new Error('Unable to derive API JWT secret from master key');
  });
}

describe('session check', () => {
  it('keys by address when the bearer cannot even be verified', async () => {
    const request = signedRequest();
    verificationFaults();
    const { keyGenerator } = globalRateLimitOptions({} as PrismaClient, { warn: vi.fn() }); // never queried here

    await expect(keyGenerator?.(request)).resolves.toBe('ip:203.0.113.7');
  });

  it("keys an upload route's bucket by address when the bearer cannot even be verified", () => {
    const request = signedRequest('/upload/brand-logo/temp');
    verificationFaults();

    expect(rateLimitKeyFromRequest(request)).toBe('ip:203.0.113.7');
  });

  it('keys by the signed identity when the revocation check does not answer within a second', async () => {
    vi.spyOn(tokenVersionCache, 'verifyTokenVersion').mockReturnValue(new Promise(() => {}));
    const log = { warn: vi.fn() };
    const { keyGenerator } = globalRateLimitOptions({} as PrismaClient, log); // never queried here

    await expect(keyGenerator?.(signedRequest())).resolves.toBe('essential:u:user-7');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
