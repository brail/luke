/**
 * `verifyJWT` answers "no session" only for a refused token (#299, ADR-052): an expired or not yet
 * valid token is routine and logged at debug, any other refusal at warn, a garbled bearer included;
 * a secret that cannot be derived is thrown, for the request's error handler to log, so it never
 * reads as an ended session.
 */

import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getApiJwtSecret } from '@luke/core/server';

import { signJWT, verifyJWT } from '../src/lib/jwt';

const { log, secret } = vi.hoisted(() => ({
  log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  secret: { fails: false },
}));

vi.mock('../src/lib/logger', async original => ({
  ...(await original<typeof import('../src/lib/logger')>()),
  rootLogger: { child: () => log },
}));
vi.mock('@luke/core/server', async original => {
  const actual = await original<typeof import('@luke/core/server')>();
  return {
    ...actual,
    getApiJwtSecret: () => {
      if (secret.fails) throw new Error('Unable to derive API JWT secret from master key');
      return actual.getApiJwtSecret();
    },
  };
});

afterEach(() => {
  secret.fails = false;
  vi.useRealTimers();
  vi.clearAllMocks();
});

const CLAIMS = { userId: 'user-1', email: 'u1@test.com', username: 'u1', role: 'viewer', tokenVersion: 0, authTime: 0 };
const signed = (options?: Parameters<typeof signJWT>[1]) => signJWT(CLAIMS, options);
const signedWith = (key: string, audience = 'luke.api') =>
  jwt.sign(CLAIMS, key, { algorithm: 'HS256', issuer: 'urn:luke', audience, expiresIn: 60 });
const base64url = (text: string) => Buffer.from(text).toString('base64url');

describe('verifyJWT', () => {
  it('accepts a valid token', () => {
    expect(verifyJWT(signed())).toMatchObject({ userId: 'user-1' });
  });

  it('refuses an expired token, logged at debug', () => {
    const token = signed({ expiresIn: 60 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);

    expect(verifyJWT(token)).toBeNull();
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('refuses a token not yet valid, logged at debug', () => {
    expect(verifyJWT(signed({ notBefore: 3600 }))).toBeNull();
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([
    ['signed with another key', () => signedWith('another-key')],
    ['for another audience', () => signedWith(getApiJwtSecret(), 'elsewhere')],
    ['malformed', () => 'not-a-token'],
    // jsonwebtoken lets the payload's `JSON.parse` error out unwrapped, as a `SyntaxError`.
    ['whose payload is not JSON', () => `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url('not json')}.sig`],
  ])('refuses a token %s, logged at warn', (_label, token) => {
    expect(verifyJWT(token())).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.debug).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('throws when the secret cannot be derived, and does not report it as a refusal', () => {
    const token = signed();
    secret.fails = true;

    expect(() => verifyJWT(token)).toThrow('Unable to derive API JWT secret from master key');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });
});
