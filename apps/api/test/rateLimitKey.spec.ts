/**
 * Chiave del rate limiter.
 *
 * Le quattro rotte di upload avevano un `keyGenerator` che leggeva
 * `req.session?.user?.id`, ma nessuno assegna mai `req.session`: il limiter è un
 * hook `onRequest`, l'auth avviene dentro l'handler. Il ramo era morto in tutte e
 * quattro e il limite finiva per essere per IP.
 */

import { describe, it, expect } from 'vitest';

import { createToken, rateLimitKeyFromRequest } from '../src/lib/auth';
import { signJWT } from '../src/lib/jwt';

import type { FastifyRequest } from 'fastify';

/** Il minimo che il generatore legge davvero. */
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
    // Non è un controllo di autenticazione: a rifiutare la richiesta è
    // l'handler, il limiter deve solo scegliere un bucket.
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
