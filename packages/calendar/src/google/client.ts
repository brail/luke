import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';

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

export function createGoogleCalendarClient(config: CalendarConfig): GoogleCalendarClient {
  _config = config;
  _client = null;
  return getClient();
}

export function getClient(): GoogleCalendarClient {
  if (_client) return _client;
  if (!_config) throw new Error('GoogleCalendarClient not initialised — call createGoogleCalendarClient first');
  _client = buildCalendarClientFromConfig(_config);
  return _client;
}

export function getWorkspaceDomain(): string {
  if (!_config) throw new Error('GoogleCalendarClient not initialised');
  return _config.workspaceDomain;
}

export function generateOAuthUrl(clientId: string, clientSecret: string, redirectUri: string): string {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [CALENDAR_SCOPE],
    prompt: 'consent',
  });
}

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
