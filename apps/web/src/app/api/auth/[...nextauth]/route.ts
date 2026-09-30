import { NextResponse } from 'next/server';

import { handlers } from '../../../../auth';
import { isLimited, loginThrottleContext, throttledSignIn } from '../../../../lib/loginThrottleContext';

import type { LoginThrottleState } from '../../../../lib/loginThrottleContext';
import type { NextRequest } from 'next/server';

/**
 * Handles GET /api/auth/[...nextauth]. Serves NextAuth.js session and provider endpoints (e.g. sign-in, sign-out, callback).
 * @auth {public}
 */
export const { GET } = handlers;

/**
 * Handles POST /api/auth/[...nextauth]. Processes NextAuth.js credential submissions and CSRF tokens.
 * @auth {public}
 *
 * NextAuth's credentials callback always answers `200 OK`, even when `authorize()` rejects
 * for being rate-limited (it collapses every failure into the same generic
 * `CredentialsSignin` result) — there is no way to change that status code from inside
 * `authorize()`. This wrapper runs the real handler inside an `AsyncLocalStorage` scope;
 * `callTRPCAuth()` (`../../../../lib/loginAuthorize.ts`) writes into that store when `auth.login`
 * responds `TOO_MANY_REQUESTS`, and if it did, we replace NextAuth's 200 with a real `429` +
 * `Retry-After`, which makes the throttle observable to monitoring and scanners (the Strix RC
 * finding). The body keeps the shape NextAuth would have returned, so `next-auth/react`'s
 * `signIn()` parses it as before; its `code` is `throttled` instead of NextAuth's `credentials`,
 * and that is what lets the login page say "too many attempts" rather than "wrong credentials".
 */
export async function POST(req: NextRequest): Promise<Response> {
  const throttleState: LoginThrottleState = {};
  const response = await loginThrottleContext.run(throttleState, () => handlers.POST(req));

  if (!isLimited(throttleState)) {
    return response;
  }

  const { body, init } = throttledSignIn(req.url, throttleState.retryAfterSeconds);
  return NextResponse.json(body, init);
}
