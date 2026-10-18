/**
 * The `authorize()` of Luke's credentials provider: one call to `auth.login` on the API, and the
 * translation of its answer into what Auth.js can carry back to the login page.
 *
 * Auth.js turns every failed `authorize()` into the same `CredentialsSignin` result, and the
 * callback always answers `200`. Two things still cross that boundary:
 *
 * - the `code` of a `CredentialsSignin` subclass thrown from `authorize()`, which `signIn()` returns
 *   to the page — used here when the login service itself is unavailable, so that the page does
 *   not tell the user their password is wrong, and for an account awaiting approval;
 * - a mark left in `loginThrottleContext`, which the route wrapper
 *   (`app/api/auth/[...nextauth]/route.ts`) turns into a real `429`.
 *
 * Kept out of `auth.ts` so that it can be tested without constructing NextAuth.
 */

import { CredentialsSignin } from 'next-auth';

import { buildTrpcUrl } from '@luke/core';

import { forwardedFor } from './clientIp';
import { debugError } from './debug';
import { markLoginThrottled } from './loginThrottleContext';

/**
 * The login could not be attempted: the API answered `SERVICE_UNAVAILABLE` (the authentication
 * service cannot complete a login, or the application is in maintenance). `code` is what reaches
 * the page, through the sign-in URL: it says nothing about the account.
 */
export class LoginUnavailable extends CredentialsSignin {
  code = 'unavailable';
}

/**
 * The password is right and the email is still to verify, under `auth.requireEmailVerification`.
 * Like `LoginPending`, answered only after the password is proven.
 */
export class LoginEmailUnverified extends CredentialsSignin {
  code = 'email_unverified';
}

/**
 * The password is right and the account awaits approval: `pending`, or `pending_email` when its
 * directory entry has no address and the page should ask for one. The API answers this only after
 * proving the password, so the code tells nothing to someone who does not have it.
 */
export class LoginPending extends CredentialsSignin {
  constructor(needsEmail: boolean) {
    super();
    this.code = needsEmail ? 'pending_email' : 'pending';
  }
}

const PENDING_MESSAGES = new Set(['ACCOUNT_PENDING_APPROVAL', 'ACCOUNT_PENDING_APPROVAL:NEEDS_EMAIL']);

/**
 * Calls the `auth.login` tRPC endpoint and returns the raw API response data, a
 * `{ pendingApproval, needsEmail }` object for accounts awaiting approval, `{ emailUnverified }`
 * for an email still to verify, or `{ unavailable }` when the API answers `SERVICE_UNAVAILABLE`.
 * Returns `null` on any other error or non-OK response.
 *
 * It returns the unavailable case instead of throwing it: the `catch` below is for a failed fetch,
 * and would swallow it.
 *
 * The client IP in `incomingHeaders` is forwarded as `X-Forwarded-For` on this server-to-server call.
 * Without it, apps/api sees every login attempt (from every real user) as coming from this
 * same internal call — collapsing the per-IP rate-limit bucket into one shared by the whole
 * app instead of one per attacker (root cause of the Strix RC brute-force finding).
 */
async function callTRPCAuth(
  username: string,
  password: string,
  incomingHeaders: { get(name: string): string | null }
) {
  try {
    const response = await fetch(buildTrpcUrl('auth.login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...forwardedFor(incomingHeaders),
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    if (!response.ok) {
      // Propagate specific errors so the frontend can handle them
      const errorData = await response.json().catch(() => null);
      const message: string = errorData?.error?.message || '';
      const code: unknown = errorData?.error?.data?.code;
      // The two exact messages `authenticateUser` throws, once the password is proven.
      if (response.status === 403 && code === 'FORBIDDEN' && PENDING_MESSAGES.has(message)) {
        return { pendingApproval: true, needsEmail: message === 'ACCOUNT_PENDING_APPROVAL:NEEDS_EMAIL' };
      }
      if (response.status === 403 && code === 'FORBIDDEN' && message === 'EMAIL_NOT_VERIFIED') {
        return { emailUnverified: true };
      }
      // Read from the code, never the message: production replaces the message of every 5xx.
      if (code === 'SERVICE_UNAVAILABLE') {
        return { unavailable: true };
      }
      // Signals the rate limit to the route wrapper ([...nextauth]/route.ts) through
      // AsyncLocalStorage: NextAuth responds with 200 anyway below (return null →
      // generic CredentialsSignin), the real 429 is constructed outside this call stack.
      if (code === 'TOO_MANY_REQUESTS') {
        const retryAfterSeconds =
          typeof errorData.error.data.retryAfterSeconds === 'number'
            ? errorData.error.data.retryAfterSeconds
            : 60;
        markLoginThrottled(retryAfterSeconds);
      }
      return null;
    }

    const data = await response.json();
    return data.result?.data;
  } catch (error) {
    debugError('Auth API call error:', error);
    return null;
  }
}

/**
 * `authorize()` for the credentials provider.
 *
 * @returns The user to open a session for, or `null` for a login that was refused.
 * @throws {LoginUnavailable} When the login service is unavailable.
 * @throws {LoginPending} When the password is right and the account awaits approval.
 * @throws {LoginEmailUnverified} When the password is right and the email is still to verify.
 */
export async function authorizeLogin(
  credentials: Partial<Record<'username' | 'password', unknown>> | undefined,
  request: { headers: { get(name: string): string | null } }
) {
  if (!credentials?.username || !credentials?.password) {
    return null;
  }

  try {
    // Call tRPC API for authentication
    const authResult = await callTRPCAuth(
      // The provider declares both fields as text inputs, so Auth.js delivers strings.
      credentials.username as string,
      credentials.password as string,
      request.headers
    );

    if (authResult?.unavailable) {
      throw new LoginUnavailable();
    }
    if (authResult?.pendingApproval) {
      throw new LoginPending(authResult.needsEmail);
    }
    if (authResult?.emailUnverified) {
      throw new LoginEmailUnverified();
    }

    if (!authResult?.user) {
      return null;
    }

    return {
      id: authResult.user.id,
      name: authResult.user.username,
      email: authResult.user.email,
      firstName: authResult.user.firstName,
      lastName: authResult.user.lastName,
      role: authResult.user.role,
      locale: authResult.user.locale,
      timezone: authResult.user.timezone,
      tokenVersion: authResult.user.tokenVersion,
      accessToken: authResult.token,
    };
  } catch (error) {
    // The one error meant to leave this function: Auth.js carries its `code` to the page.
    if (error instanceof CredentialsSignin) throw error;
    debugError('Authentication error:', error);
    return null;
  }
}
