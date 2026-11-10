/**
 * `toGoogleCalendarConfig` is the one mapping from the stored Google settings to the client
 * configuration, shared by the sync and the settings connection test (#223): a test that passes
 * must mean the sync authenticates the same way.
 */

import { describe, expect, it } from 'vitest';

import { toGoogleCalendarConfig } from '../src/services/googleCalendarSync.service';

const serviceAccount = { authMode: 'service_account' as const, serviceEmail: 'sa@example.com', serviceKey: 'key' };

describe('toGoogleCalendarConfig', () => {
  it('keeps a service account impersonation and treats an empty one as none', () => {
    expect(toGoogleCalendarConfig('example.com', { ...serviceAccount, impersonateEmail: 'luke@example.com' })).toEqual({
      mode: 'service_account',
      serviceAccountEmail: 'sa@example.com',
      serviceAccountPrivateKey: 'key',
      workspaceDomain: 'example.com',
      impersonateEmail: 'luke@example.com',
    });
    expect(toGoogleCalendarConfig('example.com', { ...serviceAccount, impersonateEmail: '' })).toMatchObject({
      impersonateEmail: undefined,
    });
  });

  it('builds an OAuth user configuration', () => {
    expect(toGoogleCalendarConfig('example.com', {
      authMode: 'oauth_user', clientId: 'id', clientSecret: 'secret', refreshToken: 'token',
    })).toEqual({ mode: 'oauth_user', clientId: 'id', clientSecret: 'secret', refreshToken: 'token', workspaceDomain: 'example.com' });
  });

  it('is null while a credential is missing', () => {
    expect(toGoogleCalendarConfig('example.com', { ...serviceAccount, serviceKey: null, impersonateEmail: null })).toBeNull();
    expect(toGoogleCalendarConfig('example.com', {
      authMode: 'oauth_user', clientId: 'id', clientSecret: 'secret', refreshToken: null,
    })).toBeNull();
  });
});
