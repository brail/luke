/**
 * The `authorize()` of Luke's credentials provider: one call to `auth.login` on the API, and the
 * translation of its answer into what Auth.js can carry back to the login page.
 *
 * Auth.js turns every failed `authorize()` into the same `CredentialsSignin` result, and the
 * callback always answers `200`. Two things still cross that boundary:
 *
 * - the `code` of a `CredentialsSignin` subclass thrown from `authorize()`, which `signIn()` returns
 *   to the page — used only for answers the API gives once the password is proven: an account
 *   awaiting approval, an email still to verify, maintenance, a directory that verified the
 *   password and could not complete the login, or whose mail another account holds;
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
import { GATEWAY_STATUSES } from './trpcFetch';

/**
 * The API answered `SERVICE_UNAVAILABLE` with the reason `auth_unavailable`: sign-in is unavailable
 * for everyone (no valid strategy stored, before any password check), or the directory verified the
 * password and the login could not be completed. Either way nothing here may rely on the password
 * being proven.
 */
export class LoginUnavailable extends CredentialsSignin {
  code = 'unavailable';
}

/**
 * The API could not be reached, or answered unavailable without saying it is sign-in (a proxy's
 * gateway status, a 503 with no or another reason): the service is down for everyone, whatever the
 * credentials, so it tells nothing about the account (#259).
 */
export class LoginServiceUnavailable extends CredentialsSignin {
  code = 'service_unavailable';
}

/**
 * The password is right and maintenance is active for a role that cannot bypass it. Like
 * `LoginPending`, answered only after the password is proven.
 */
export class LoginMaintenance extends CredentialsSignin {
  code = 'maintenance';
}

/**
 * The directory verified the password of a first sign-in whose mail another Luke account holds
 * (#266): never linked, the administrator resolves it. Like `LoginPending`, answered only after the
 * password is proven.
 */
export class LoginEmailInUse extends CredentialsSignin {
  code = 'email_in_use';
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
 * for an email still to verify, `{ maintenance }` for maintenance, `{ emailInUse }` for a directory
 * mail another account holds, `{ unavailable }` when the API answers `SERVICE_UNAVAILABLE` for sign-in,
 * or `{ serviceUnavailable }` for a failed fetch, a gateway status or a 503 for another reason.
 * Returns `null` on any other non-OK response: every refusal before the password is proven, which the
 * page answers with one message.
 *
 * It returns the unavailable cases instead of throwing them: the outer `catch` of `authorizeLogin`
 * would swallow them.
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
      // The exact markers `authenticateUser` throws, once the password is proven.
      if (response.status === 403 && code === 'FORBIDDEN' && PENDING_MESSAGES.has(message)) {
        return { pendingApproval: true, needsEmail: message === 'ACCOUNT_PENDING_APPROVAL:NEEDS_EMAIL' };
      }
      if (response.status === 403 && code === 'FORBIDDEN' && message === 'EMAIL_NOT_VERIFIED') {
        return { emailUnverified: true };
      }
      if (response.status === 403 && code === 'FORBIDDEN' && message === 'MAINTENANCE_ACTIVE') {
        return { maintenance: true };
      }
      if (response.status === 403 && code === 'FORBIDDEN' && message === 'LDAP_EMAIL_IN_USE') {
        return { emailInUse: true };
      }
      // Read from the reason, never the message: production replaces the message of every 5xx. Only
      // `auth_unavailable` is sign-in's; maintenance before a proof would be the same for everyone,
      // and is not the post-proof `MAINTENANCE_ACTIVE` marker above.
      if (code === 'SERVICE_UNAVAILABLE' || GATEWAY_STATUSES.has(response.status)) {
        const reason: unknown = errorData?.error?.data?.unavailableReason;
        return reason === 'auth_unavailable' ? { unavailable: true } : { serviceUnavailable: true };
      }
      // The caller's own per-IP bucket (the API's per-account one answers like a wrong password).
      // Signals it to the route wrapper ([...nextauth]/route.ts) through AsyncLocalStorage:
      // NextAuth responds with 200 anyway below (return null → generic CredentialsSignin), the
      // real 429 is constructed outside this call stack. The global limiter's 429 carries no tRPC
      // code, and reads as any other refusal.
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
    // The API could not be reached, or answered something unreadable: the service is down for
    // everyone, not a refusal (owner, #259).
    debugError('Auth API call error:', error);
    return { serviceUnavailable: true };
  }
}

/**
 * `authorize()` for the credentials provider.
 *
 * @returns The user to open a session for, or `null` for a login that was refused.
 * @throws {LoginUnavailable} When sign-in is unavailable (no valid strategy, or the directory verified
 *   the password and the login could not complete).
 * @throws {LoginServiceUnavailable} When the API cannot be reached, answers a gateway status, or a 503
 *   for a reason other than sign-in's.
 * @throws {LoginMaintenance} When the password is right and maintenance is active.
 * @throws {LoginPending} When the password is right and the account awaits approval.
 * @throws {LoginEmailUnverified} When the password is right and the email is still to verify.
 * @throws {LoginEmailInUse} When the directory verified the password and its mail is another account's.
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
    if (authResult?.serviceUnavailable) {
      throw new LoginServiceUnavailable();
    }
    if (authResult?.pendingApproval) {
      throw new LoginPending(authResult.needsEmail);
    }
    if (authResult?.emailUnverified) {
      throw new LoginEmailUnverified();
    }
    if (authResult?.maintenance) {
      throw new LoginMaintenance();
    }
    if (authResult?.emailInUse) {
      throw new LoginEmailInUse();
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
