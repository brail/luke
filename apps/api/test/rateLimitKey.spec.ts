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
  it('un bearer valido dà l’id utente', () => {
    const token = createToken({
      id: 'user-42',
      email: 'a@b.test',
      username: 'a',
      role: 'viewer',
      tokenVersion: 0,
    });

    expect(rateLimitKeyFromRequest(req(`Bearer ${token}`))).toBe('user-42');
  });

  it('un bearer scaduto ricade sull’IP', () => {
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

  it('senza Authorization ricade sull’IP', () => {
    expect(rateLimitKeyFromRequest(req())).toBe('203.0.113.7');
  });

  it('un header malformato ricade sull’IP', () => {
    expect(rateLimitKeyFromRequest(req('Bearer non-un-jwt'))).toBe('203.0.113.7');
  });
});
