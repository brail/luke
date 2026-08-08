/**
 * The token that binds an upload slot to its user.
 *
 * `confirmUpload` used to accept bucket and key from the input without comparing
 * them against anything. The bucket was constrained by the enum, the key wasn't: with the
 * key of a blob uploaded by someone else, you could get a `FileObject` created with your
 * own `createdBy`, and from there `confirmPendingFile` would let it be linked as your own file —
 * that predicate checks ownership of the row, and it's `confirmUpload` that
 * decides who owns the row.
 */

import { describe, it, expect } from 'vitest';

import { signUploadToken, verifyUploadToken } from '../src/utils/downloadToken';

describe('upload token', () => {
  const slot = {
    bucket: 'company-assets' as const,
    key: '2026/07/31/abc.png',
    userId: 'user-1',
  };

  it('round-trip: bucket, key e utente sopravvivono alla firma', () => {
    const payload = verifyUploadToken(signUploadToken(slot));

    expect(payload.bucket).toBe(slot.bucket);
    expect(payload.key).toBe(slot.key);
    expect(payload.userId).toBe(slot.userId);
  });

  it('un payload manomesso non verifica', () => {
    const token = signUploadToken(slot);
    const [payloadB64, signature] = token.split('.');

    // Rewrites the key to point at someone else's blob, keeping the original signature.
    const tampered = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );
    tampered.key = '2026/07/31/altrui.png';
    const forged = `${Buffer.from(JSON.stringify(tampered))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')}.${signature}`;

    expect(() => verifyUploadToken(forged)).toThrow();
  });

  it('un token scaduto non verifica', () => {
    expect(() => verifyUploadToken(signUploadToken({ ...slot, ttlMs: -1000 }))).toThrow();
  });

  it('una firma di altro tipo non passa per un token di upload', () => {
    expect(() => verifyUploadToken('non-un-token')).toThrow();
  });
});
