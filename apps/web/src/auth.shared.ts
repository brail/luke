import { debugLog } from './lib/debug';

import type { JWT } from 'next-auth/jwt';
import type { Session } from 'next-auth';

export const SESSION_MAX_AGE = 8 * 60 * 60; // 8 ore
export const SESSION_UPDATE_AGE = 4 * 60 * 60; // Refresh ogni 4 ore (50% lifetime)

export function checkTokenVersion(token: JWT): JWT | null {
  if (token.tokenVersion === undefined || token.tokenVersion === null) {
    debugLog('JWT senza tokenVersion, forzo logout');
    return null;
  }
  return token;
}

export function populateSession(session: Session, token: JWT): Session {
  session.user.id = token.sub || '';
  session.user.role = token.role as string;
  session.user.firstName = token.firstName as string;
  session.user.lastName = token.lastName as string;
  session.user.locale = token.locale as string;
  session.user.timezone = token.timezone as string;
  session.user.tokenVersion = token.tokenVersion as number;
  session.accessToken = token.accessToken as string;
  return session;
}
