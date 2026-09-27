/**
 * `clientIpFrom` takes the LAST `X-Forwarded-For` entry: the reverse proxy appends the peer it
 * saw, so the first entries are whatever the client chose to send (audit 2026-08-07).
 */

import { describe, expect, it } from 'vitest';

import { clientIpFrom } from '../clientIp';

describe('clientIpFrom', () => {
  it('trusts the entry the proxy appended, not the ones the client sent', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('is undefined without the header', () => {
    expect(clientIpFrom(new Headers())).toBeUndefined();
  });
});
