import { NextRequest, NextResponse } from 'next/server';

/**
 * Handles GET /api/google/oauth/callback. Receives the Google OAuth 2.0 authorization code and
 * redirects to /settings/google, forwarding either `oauth_code` and `oauth_state` on success or
 * `oauth_error` on failure. The API exchanges a code only with its flow's state (#143).
 * @auth {public}
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const settingsUrl = new URL('/settings/google', request.url);

  if (error || !code) {
    settingsUrl.searchParams.set('oauth_error', error ?? 'access_denied');
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set('oauth_code', code);
  if (state) settingsUrl.searchParams.set('oauth_state', state);
  return NextResponse.redirect(settingsUrl);
}
