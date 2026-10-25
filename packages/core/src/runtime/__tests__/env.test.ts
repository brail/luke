import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiUrl } from '../../net/url.js';
import { getApiBaseUrl } from '../env.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/**
 * The browser reaches the API on the page's own origin, through the Next rewrites, so the page's
 * scheme is the API's: nothing baked at build time can turn an https page into mixed content.
 */
describe('getApiBaseUrl', () => {
  it('is the same origin in the browser', () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('INTERNAL_API_URL', 'http://api:3001');

    expect(getApiBaseUrl()).toBe('');
    expect(buildApiUrl('/trpc/auth.login')).toBe('/trpc/auth.login');
  });

  it('uses the internal URL on the server', () => {
    vi.stubEnv('INTERNAL_API_URL', 'http://api:3001');

    expect(getApiBaseUrl()).toBe('http://api:3001');
  });

  it('falls back to the local API on the server', () => {
    vi.stubEnv('INTERNAL_API_URL', undefined);

    expect(getApiBaseUrl()).toBe('http://localhost:3001');
  });
});
