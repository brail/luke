import { google } from 'googleapis';

import type { calendar_v3 } from 'googleapis';

/**
 * Authentication configuration for the Google Calendar client.
 * Supports two modes: a Google Workspace service account (with optional
 * impersonation) or a user OAuth 2.0 refresh token.
 */
export type CalendarConfig =
  | {
      mode: 'service_account';
      serviceAccountEmail: string;
      serviceAccountPrivateKey: string;
      workspaceDomain: string;
      impersonateEmail?: string;
    }
  | {
      mode: 'oauth_user';
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      workspaceDomain: string;
    };

/**
 * Type alias for the googleapis `calendar_v3.Calendar` client instance.
 */
export type GoogleCalendarClient = calendar_v3.Calendar;

let _client: GoogleCalendarClient | null = null;
let _config: CalendarConfig | null = null;

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

function normalizeKey(key: string): string {
  return key.replace(/\\n/g, '\n');
}

function buildCalendarClientFromConfig(config: CalendarConfig): GoogleCalendarClient {
  if (config.mode === 'service_account') {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: config.serviceAccountEmail,
        private_key: normalizeKey(config.serviceAccountPrivateKey),
      },
      scopes: [CALENDAR_SCOPE],
      clientOptions: config.impersonateEmail ? { subject: config.impersonateEmail } : undefined,
    });
    return google.calendar({ version: 'v3', auth });
  } else {
    const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
    oauth2Client.setCredentials({ refresh_token: config.refreshToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }
}

/**
 * Initialises the singleton Google Calendar client with the given configuration.
 * Must be called before any other function in this module that invokes `getClient()`.
 *
 * Calling this again with a new config replaces the active client.
 *
 * @returns The newly created `GoogleCalendarClient` instance
 */
export function createGoogleCalendarClient(config: CalendarConfig): GoogleCalendarClient {
  _config = config;
  _client = null;
  return getClient();
}

/**
 * Returns the singleton Google Calendar client, building it lazily from the active config.
 *
 * @throws {Error} If `createGoogleCalendarClient` has not been called yet
 */
export function getClient(): GoogleCalendarClient {
  if (_client) return _client;
  if (!_config) throw new Error('GoogleCalendarClient not initialised — call createGoogleCalendarClient first');
  _client = buildCalendarClientFromConfig(_config);
  return _client;
}

/**
 * Returns the Google Workspace domain of the active configuration.
 *
 * @throws {Error} If `createGoogleCalendarClient` has not been called yet
 */
export function getWorkspaceDomain(): string {
  if (!_config) throw new Error('GoogleCalendarClient not initialised');
  return _config.workspaceDomain;
}

/**
 * Generates a Google OAuth 2.0 authorization URL that requests offline access
 * and forces the consent screen to always appear (ensuring a refresh token is returned).
 *
 * @returns The URL to redirect the user to for Google authorization
 */
export function generateOAuthUrl(clientId: string, clientSecret: string, redirectUri: string): string {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [CALENDAR_SCOPE],
    prompt: 'consent',
  });
}

/**
 * Exchanges a Google OAuth 2.0 authorization code for a refresh token and
 * retrieves the authenticated user's email address.
 *
 * @throws {Error} When Google does not return a refresh token (prompt=consent must be enabled)
 * @returns The permanent refresh token and the user's Google account email
 */
export async function exchangeOAuthCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<{ refreshToken: string; userEmail: string }> {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Nessun refresh_token ricevuto — assicurati che il prompt=consent sia abilitato');
  }
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return { refreshToken: tokens.refresh_token, userEmail: data.email ?? '' };
}

/**
 * Validates a Google Calendar configuration by attempting to list calendars.
 * Uses a temporary client so it does not affect the active singleton.
 *
 * @returns `{ ok: true }` on success, or `{ ok: false, error: string }` on failure
 */
export async function testGoogleConnection(config: CalendarConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const cal = buildCalendarClientFromConfig(config);
    await cal.calendarList.list({ maxResults: 1 });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}
