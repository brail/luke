/**
 * `clientIpFrom` takes the LAST `X-Forwarded-For` entry: the reverse proxy appends the peer it
 * saw, so the first entries are whatever the client chose to send (audit 2026-08-07).
 */

import { describe, expect, it } from 'vitest';

import { clientIpFrom, forwardedFor } from '../clientIp';

describe('clientIpFrom', () => {
  it('trusts the entry the proxy appended, not the ones the client sent', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('is undefined without the header', () => {
    expect(clientIpFrom(new Headers())).toBeUndefined();
  });
});

describe('forwardedFor', () => {
  it('forwards the client IP as X-Forwarded-For', () => {
    expect(forwardedFor(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toEqual({
      'X-Forwarded-For': '203.0.113.7',
    });
  });

  it('adds no header when there is no client IP', () => {
    expect(forwardedFor(new Headers())).toEqual({});
  });
});
