import { debugLog } from './lib/debug';

import type { Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

/** Session lifetime in seconds (8 hours). */
export const SESSION_MAX_AGE = 8 * 60 * 60;

/** Session refresh interval in seconds (4 hours — 50 % of max age). */
export const SESSION_UPDATE_AGE = 4 * 60 * 60;

/**
 * Guards the JWT token by ensuring `tokenVersion` is present.
 * Returns `null` (forces re-login) when the claim is missing,
 * otherwise returns the token unchanged.
 */
export function checkTokenVersion(token: JWT): JWT | null {
  if (token.tokenVersion === undefined || token.tokenVersion === null) {
    debugLog('JWT senza tokenVersion, forzo logout');
    return null;
  }
  return token;
}

/**
 * Copies user claims from a JWT token into the Auth.js `Session` object.
 * Called by both the Node.js and Edge `session` callbacks to keep them in sync.
 */
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
