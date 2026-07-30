/**
 * Il token che lega una slot di upload al suo utente.
 *
 * `confirmUpload` accettava bucket e key dall'input e non li confrontava con
 * nulla. Il bucket era vincolato dall'enum, la key no: con la key di un blob
 * caricato da un altro ci si faceva creare un `FileObject` con `createdBy`
 * proprio, e da lì `confirmPendingFile` lo lasciava collegare come file proprio —
 * quel predicato verifica la proprietà della riga, ed è `confirmUpload` a
 * decidere chi possiede la riga.
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

    // Riscrive la key puntando al blob di un altro, tenendo la firma originale.
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
