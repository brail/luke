import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const settingsUrl = new URL('/settings/google', request.url);

  if (error || !code) {
    settingsUrl.searchParams.set('oauth_error', error ?? 'access_denied');
    return NextResponse.redirect(settingsUrl);
  }

  settingsUrl.searchParams.set('oauth_code', code);
  return NextResponse.redirect(settingsUrl);
}
