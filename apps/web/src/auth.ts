import 'server-only';

import { headers as requestHeaders } from 'next/headers';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { buildTrpcUrl, isProduction } from '@luke/core';
import { getNextAuthSecret } from '@luke/core/server';

import { checkTokenVersion, populateSession, SESSION_MAX_AGE, SESSION_UPDATE_AGE } from './auth.shared';
import { forwardedFor } from './lib/clientIp';
import { debugError, debugLog, debugWarn } from './lib/debug';
import { authorizeLogin } from './lib/loginAuthorize';
import { trpcFetch } from './lib/trpcFetch';

import type { NextAuthConfig } from 'next-auth';

function resolveNextAuthSecret(): string {
  const envSecret = process.env.NEXTAUTH_SECRET;
  if (!envSecret && isProduction()) {
    throw new Error('NEXTAUTH_SECRET env var required in production');
  }
  return envSecret ?? getNextAuthSecret();
}

interface LukeAuthUser {
  role: string;
  accessToken: string;
  firstName: string;
  lastName: string;
  locale: string;
  timezone: string;
  tokenVersion: number;
}

// Forza runtime Node.js: necessari moduli Node in @luke/core/server
export const runtime = 'nodejs';

// Throttles the token refresh: no new `auth.refreshToken` call for a user before this instant.
// 30 s — an acceptable window between session revocation and forced logout. A 429 pushes it to the
// limiter's `Retry-After`, capped so a malformed header cannot stop refreshes for long.
const refreshNotBefore = new Map<string, number>(); // userId → epoch ms
const REFRESH_THROTTLE_MS = 30_000;
const REFRESH_DEFERRAL_CAP = 5 * 60_000;
const REFRESH_TIMEOUT_MS = 5_000;

/**
 * Full Auth.js v5 configuration for Luke (Node.js runtime only).
 * Uses the `Credentials` provider backed by the `auth.login` tRPC endpoint.
 * JWT callbacks verify `tokenVersion` on each token refresh, using a 30 s
 * in-memory cache to throttle redundant API calls. The `session` callback
 * populates the client-visible session from the JWT via `populateSession`.
 */
export const config = {
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: authorizeLogin,
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE,
    updateAge: SESSION_UPDATE_AGE,
  },
  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        // COOKIE_SECURE=false in .env when using HTTP (NPM without SSL)
        secure:
          process.env.NODE_ENV === 'production' &&
          process.env.COOKIE_SECURE !== 'false',
        sameSite: 'lax', // 'strict' for same domain without cross-origin
        path: '/',
        // domain: '.example.com' if Web and API are on different subdomains
      },
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // If URL is relative, use baseUrl
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      // If URL is from the same domain, allow it
      else if (new URL(url).origin === baseUrl) return url;
      // Otherwise redirect to dashboard
      return `${baseUrl}/dashboard`;
    },
    async jwt({ token, user, trigger }) {
      // Pass user data to JWT token
      if (user) {
        // First login: save all data in token
        const lukeUser = user as unknown as LukeAuthUser;
        token.role = lukeUser.role;
        token.accessToken = lukeUser.accessToken;
        token.firstName = lukeUser.firstName;
        token.lastName = lukeUser.lastName;
        token.locale = lukeUser.locale;
        token.timezone = lukeUser.timezone;
        token.tokenVersion = lukeUser.tokenVersion;
        // Add nbf (not-before) claim to prevent premature use
        token.nbf = Math.floor(Date.now() / 1000);
        // Add aud/iss claims for cross-service validation
        token.aud = 'luke.web';
        token.iss = 'urn:luke';
      } else if (token.sub && trigger !== 'update') {
        if (checkTokenVersion(token) === null) return null;

        // Refresh token: re-mint the API accessToken by calling auth.refreshToken
        // (with TTL cache). protectedProcedure validates expired Bearer and revoked tokenVersion
        // → `sessionEnded` → logout. If successful, updates the embedded accessToken,
        // so a still-valid NextAuth session never sends an expired JWT
        // (root cause of the `jwt expired` error).
        if (Date.now() >= (refreshNotBefore.get(token.sub) ?? 0)) {
          // Set before the call, whatever its outcome: at most one refresh per user per TTL. Set
          // only on success, a 429 kept the cache cold, and every image request (each one runs
          // `auth()`) fired another refresh counted by the API's global limiter — keeping it spent.
          refreshNotBefore.set(token.sub, Date.now() + REFRESH_THROTTLE_MS);
          try {
            // `trpcFetch`: the global limiter's 429 arrives as TOO_MANY_REQUESTS with its wait.
            const response = await trpcFetch(buildTrpcUrl('auth.refreshToken'), {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
                // The callback gets no request, but it always runs inside one (rule 13).
                ...forwardedFor(await requestHeaders()),
              },
              body: JSON.stringify({}),
              // A hung API must not hold every `auth()` of this user.
              signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
            });
            // Check the semantic tRPC code in the body — more robust than HTTP status
            const body = await response.json().catch(() => null);
            if (body?.error?.data?.code === 'TOO_MANY_REQUESTS') {
              // Not before the limiter's window has passed; the session stays (ADR-051).
              const retryAfter: unknown = body.error.data.retryAfterSeconds;
              const waitMs = typeof retryAfter === 'number' ? retryAfter * 1000 : 0;
              refreshNotBefore.set(
                token.sub,
                Date.now() + Math.min(Math.max(waitMs, REFRESH_THROTTLE_MS), REFRESH_DEFERRAL_CAP)
              );
            }
            // Only an ended session signs out (ADR-052), never another UNAUTHORIZED.
            if (body?.error?.data?.sessionEnded === true) {
              debugLog('Invalid tokenVersion or expired token during JWT refresh, forcing logout');
              refreshNotBefore.delete(token.sub);
              return null; // Force re-login
            }
            const freshToken = body?.result?.data?.token as string | undefined;
            if (!response.ok || !freshToken) {
              debugError('Transient token refresh error (ignored):', response.status);
            } else {
              token.accessToken = freshToken;
            }
          } catch (error) {
            const isNetworkError = error instanceof TypeError && error.message === 'fetch failed';
            const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
            if (isTimeout) {
              debugWarn(`JWT refresh timed out after ${REFRESH_TIMEOUT_MS} ms; token kept`);
            } else if (!isNetworkError) {
              debugError('Error checking tokenVersion during JWT refresh:', error);
            }
            // On a network error or a timeout, keep the token: the next attempt comes after the TTL.
          }
        }

        debugLog('JWT refresh for user:', token.sub);
      }
      return token;
    },
    async session({ session, token }) {
      if (token) populateSession(session, token);
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  // Required when running behind a reverse proxy (NPM, nginx, etc.)
  // Auth.js v5 validates the Host header; trustHost bypasses that check
  // and relies on NEXTAUTH_URL being set correctly instead.
  trustHost: true,
  // NEXTAUTH_SECRET (env) takes precedence over getNextAuthSecret() (file system).
  // In prod: env var is injected by Docker Compose; fallback to file system is forbidden
  // because the web container does not mount the ~/.luke/secret.key volume (API-only).
  // In dev: fallback to file system via getNextAuthSecret() for initial setup.
  secret: resolveNextAuthSecret(),
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
