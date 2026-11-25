import { isTRPCClientError } from '@trpc/client';
import { signOut } from 'next-auth/react';

import type { AppRouter } from '@luke/api';

import { debugError } from './debug';

/** Set by the first automatic sign-out of this page, so the others it races do nothing. */
let ending = false;

/**
 * Whether a tRPC error says the session is over (`data.sessionEnded`, ADR-052): the only sign-out
 * signal. A bare `UNAUTHORIZED` — a wrong current password, a request that carried no bearer yet —
 * is not one.
 */
export function isSessionEnded(error: unknown): boolean {
  return isTRPCClientError<AppRouter>(error) && error.data?.sessionEnded === true;
}

/**
 * Signs the browser out to `/login`, once per page: the pushed `session-revoked`, a query or
 * mutation answering `sessionEnded` and the page's own revocation can all arrive together. The API
 * has already ended the session, so nothing calls it (unlike `serverLogout`, ADR-048). When the
 * client sign-out fails (its fetches can, during a redeploy or a network blip), the page leaves
 * through the server route instead, which clears the cookie with no client fetch: the once-flag
 * must never leave a tab on a dead session.
 */
export function endSession(): void {
  if (ending) return;
  ending = true;
  signOut({ callbackUrl: '/login' }).catch((error: unknown) => {
    debugError('Automatic sign-out failed; leaving through the server route', error);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a route handler, not a page: a full navigation that needs no client fetch
    window.location.assign('/api/auth/force-logout');
  });
}
