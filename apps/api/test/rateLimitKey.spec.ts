/**
 * Rate limiter key.
 *
 * The four upload routes had a `keyGenerator` that read
 * `req.session?.user?.id`, but nothing ever assigns `req.session`: the limiter is an
 * `onRequest` hook, auth happens inside the handler. The branch was dead in all
 * four and the limit ended up being per-IP.
 */

import { describe, it, expect } from 'vitest';

import { createToken, rateLimitKeyFromRequest } from '../src/lib/auth';
import { signJWT } from '../src/lib/jwt';

import type { FastifyRequest } from 'fastify';

/** The minimum that the generator actually reads. */
function req(authorization?: string): FastifyRequest {
  return {
    ip: '203.0.113.7',
    headers: authorization ? { authorization } : {},
  } as unknown as FastifyRequest;
}

describe('rateLimitKeyFromRequest', () => {
  it('a valid bearer yields the user id', () => {
    const token = createToken({
      id: 'user-42',
      email: 'a@b.test',
      username: 'a',
      role: 'viewer',
      tokenVersion: 0,
    });

    expect(rateLimitKeyFromRequest(req(`Bearer ${token}`))).toBe('user-42');
  });

  it('an expired bearer falls back to the IP', () => {
    // This is not an authentication check: it's the handler that rejects
    // the request, the limiter only needs to pick a bucket.
    const expired = signJWT(
      {
        userId: 'user-42',
        email: 'a@b.test',
        username: 'a',
        role: 'viewer',
        tokenVersion: 0,
      },
      { expiresIn: '-1h' }
    );

    expect(rateLimitKeyFromRequest(req(`Bearer ${expired}`))).toBe('203.0.113.7');
  });

  it('without Authorization it falls back to the IP', () => {
    expect(rateLimitKeyFromRequest(req())).toBe('203.0.113.7');
  });

  it('un header malformato ricade sull’IP', () => {
    expect(rateLimitKeyFromRequest(req('Bearer non-un-jwt'))).toBe('203.0.113.7');
  });
});
