import 'server-only';

import { TRPCClientError } from '@trpc/client';
import { decode, getToken } from 'next-auth/jwt';

import { config, signOut } from '../auth';

import { createAuthedTrpcClient } from './trpcAuth';

/** How long the API gets to end the sessions before this browser's is cleared anyway. */
const REVOCATION_TIMEOUT_MS = 5_000;

/** The origin users reach Luke on: `NEXTAUTH_URL`'s, or the request's own when it is unset (dev). */
function publicOrigin(request: Request): string {
  // nosemgrep: luke-no-direct-env -- NEXTAUTH_URL is a permitted web bootstrap variable (Env Policy)
  return new URL(process.env.NEXTAUTH_URL || request.url).origin;
}

/**
 * Whether the request comes from a Luke page. Fetch Metadata first (OWASP CSRF cheat sheet); a
 * browser that sends none, or one that says `same-site`, must name the public origin in `Origin`,
 * or failing that in `Referer`. `Origin: null` is never accepted, and it does not fall back.
 */
function fromLuke(request: Request): boolean {
  const { headers } = request;
  if (headers.get('sec-fetch-site') === 'same-origin') return true;
  const source = headers.has('origin') ? headers.get('origin') : URL.parse(headers.get('referer') ?? '')?.origin;
  return source === publicOrigin(request);
}

/**
 * Ends the API sessions with the bearer the session cookie holds. The cookie is read, never
 * refreshed: `auth()` runs the `jwt` callback, whose token refresh has no deadline. `true` once
 * the API has ended them or answers UNAUTHORIZED, and when there is no session cookie at all:
 * either way nothing is left to end from this browser. A cookie that cannot be read is `false`.
 */
async function endApiSessions(request: Request): Promise<boolean> {
  try {
    const cookieName = config.cookies.sessionToken.name;
    // Raw first: `null` only when there is no session cookie, chunks reassembled. The decode throws
    // on a cookie it cannot read, which the catch counts as not ended.
    const raw = await getToken({ req: request, cookieName, raw: true });
    if (raw === null) return true;
    const token = await decode({ token: raw, secret: config.secret, salt: cookieName });
    if (typeof token?.accessToken !== 'string') return false;
    await createAuthedTrpcClient(token.accessToken, request.headers).auth.logout.mutate(undefined, {
      signal: AbortSignal.timeout(REVOCATION_TIMEOUT_MS),
    });
    return true;
  } catch (error) {
    return error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
  }
}

/** 303, so the browser follows with a GET; a relative target stays on the origin it came from. */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/**
 * The one sign-out path (#238, ADR-048), behind `POST /api/auth/logout`. A request whose
 * provenance cannot be verified changes nothing and is sent to the confirmation page. Any other
 * clears this browser's session whatever the API answered — maintenance, a request limit, an
 * error or no answer in time — and says so on the login page when the server-side end failed.
 */
export async function serverLogout(request: Request): Promise<Response> {
  if (!fromLuke(request)) return seeOther('/logout');
  const ended = await endApiSessions(request);
  // Writes the deletion of every session cookie chunk; Next merges them into the response.
  await signOut({ redirect: false });
  return seeOther(ended ? '/login' : '/login?signout=incomplete');
}
