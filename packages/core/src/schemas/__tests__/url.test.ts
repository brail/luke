/**
 * `httpUrl`: the URLs someone follows or is redirected to — `app.baseUrl` in every email link, the
 * Google OAuth redirect, the company website — accept http(s) only. `z.url()` alone accepts
 * `javascript:`, and `z.httpUrl()` refuses the hosts this application runs on (#101).
 */

import { describe, it, expect } from 'vitest';

import { CompanyProfileInputSchema } from '../companyProfile.js';
import { APP_CONFIG_DEFAULTS, AppConfigRegistry } from '../config.js';
import { mailSmtpConfigSchema } from '../mail.js';
import { httpUrl } from '../url.js';

const REFUSED = ['javascript:alert(1)', 'data:text/html,x', 'ftp://files.example.test', 'luke.example.test'];
const ACCEPTED = [
  'http://localhost:3000',
  'http://10.0.0.5:3000',
  'http://luke',
  'https://luke.febos.local/',
  'HTTPS://LUKE.EXAMPLE.TEST',
];

describe('httpUrl', () => {
  it.each(REFUSED)('refuses %s', value => {
    expect(httpUrl().safeParse(value).success).toBe(false);
  });

  it.each(ACCEPTED)('accepts %s', value => {
    expect(httpUrl().safeParse(value).success).toBe(true);
  });

  it('reports the message it is given', () => {
    expect(httpUrl('URL valido richiesto').safeParse('javascript:x').error?.issues[0]?.message).toBe(
      'URL valido richiesto'
    );
  });
});

describe('the schemas that take it', () => {
  it('app.baseUrl refuses another scheme and still accepts its own default', () => {
    expect(AppConfigRegistry['app.baseUrl'].safeParse('javascript:alert(1)').success).toBe(false);
    expect(AppConfigRegistry['app.baseUrl'].safeParse(APP_CONFIG_DEFAULTS['app.baseUrl']).success).toBe(true);
  });

  it('the mail form refuses another scheme for the base URL it writes to app.baseUrl', () => {
    const shape = mailSmtpConfigSchema.shape.baseUrl;
    expect(shape.safeParse('javascript:alert(1)').error?.issues[0]?.message).toBe('URL valido richiesto');
  });

  it('the company website refuses another scheme and stays optional', () => {
    const website = CompanyProfileInputSchema.shape.website;
    expect(website.safeParse('javascript:alert(1)').success).toBe(false);
    expect(website.safeParse(undefined).success).toBe(true);
  });
});
