import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';

export interface CalendarConfig {
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  workspaceDomain: string;
}

export type GoogleCalendarClient = calendar_v3.Calendar;

let _client: GoogleCalendarClient | null = null;
let _config: CalendarConfig | null = null;

export function createGoogleCalendarClient(config: CalendarConfig): GoogleCalendarClient {
  _config = config;
  _client = null; // reset on new config
  return getClient();
}

export function getClient(): GoogleCalendarClient {
  if (_client) return _client;
  if (!_config) throw new Error('GoogleCalendarClient not initialised — call createGoogleCalendarClient first');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: _config.serviceAccountEmail,
      private_key: _config.serviceAccountPrivateKey,
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  _client = google.calendar({ version: 'v3', auth });
  return _client;
}

export function getWorkspaceDomain(): string {
  if (!_config) throw new Error('GoogleCalendarClient not initialised');
  return _config.workspaceDomain;
}
