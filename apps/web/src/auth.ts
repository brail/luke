import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { buildTrpcUrl, isProduction } from '@luke/core';
import { getNextAuthSecret } from '@luke/core/server';

import { checkTokenVersion, populateSession, SESSION_MAX_AGE, SESSION_UPDATE_AGE } from './auth.shared';
import { debugError, debugLog } from './lib/debug';
import { markLoginThrottled } from './lib/loginThrottleContext';

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

// Cache tokenVersion validation: evita fetch ripetuti a me.get per lo stesso utente.
// TTL 30s — finestra accettabile tra revoca sessione e logout forzato.
const tokenVersionCache = new Map<string, number>(); // userId → validatedAt (ms)
const TOKEN_VERSION_CACHE_TTL = 30_000;

/**
 * Extracts the real client IP from the incoming request's `X-Forwarded-For` header. NPM
 * (Nginx Proxy Manager) sits in front of apps/web in every deployed environment (see
 * `trustHost` comment below) and uses `$proxy_add_x_forwarded_for`, which APPENDS its own
 * resolved peer address rather than replacing an existing header — so the real client IP is
 * the LAST entry, not the first. Taking the first entry (`[0]`) would return whatever value
 * an attacker chooses to send in their own `X-Forwarded-For` header, defeating IP-based
 * rate limiting (CRITICAL, audit 2026-08-07). `undefined` if absent (e.g. local `pnpm dev`
 * without a reverse proxy).
 */
function extractClientIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  return forwardedFor?.split(',').pop()?.trim() || undefined;
}

/**
 * Calls the `auth.login` tRPC endpoint and returns the raw API response data,
 * or a `{ pendingApproval, needsEmail }` object for accounts awaiting approval.
 * Returns `null` on any error or non-OK response.
 *
 * `clientIp`, when present, is forwarded as `X-Forwarded-For` on this server-to-server call.
 * Without it, apps/api sees every login attempt (from every real user) as coming from this
 * same internal call — collapsing the per-IP rate-limit bucket into one shared by the whole
 * app instead of one per attacker (root cause of the Strix RC brute-force finding).
 */
async function callTRPCAuth(username: string, password: string, clientIp?: string) {
  try {
    const response = await fetch(buildTrpcUrl('auth.login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(clientIp ? { 'X-Forwarded-For': clientIp } : {}),
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    if (!response.ok) {
      // Propaga errori specifici per gestione frontend
      const errorData = await response.json().catch(() => null);
      const message: string = errorData?.error?.message || '';
      if (message.startsWith('ACCOUNT_PENDING_APPROVAL')) {
        return { pendingApproval: true, needsEmail: message.includes('NEEDS_EMAIL') };
      }
      // Segnala il rate-limit al wrapper della route ([...nextauth]/route.ts) tramite
      // AsyncLocalStorage: NextAuth risponde comunque 200 qui sotto (return null →
      // CredentialsSignin generico), il 429 reale viene costruito fuori da questa call stack.
      if (errorData?.error?.data?.code === 'TOO_MANY_REQUESTS') {
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
    debugError('Errore chiamata API auth:', error);
    return null;
  }
}

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
      async authorize(credentials, request) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        try {
          // Chiama l'API tRPC per l'autenticazione
          const authResult = await callTRPCAuth(
            credentials.username as string,
            credentials.password as string,
            extractClientIp(request)
          );

          // Utente LDAP in attesa di approvazione: Auth.js non permette di
          // propagare errori custom da authorize(), ritorniamo null.
          // Il login page rileva il pending con una chiamata separata.
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
          debugError('Errore autenticazione:', error);
          return null;
        }
      },
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
        // COOKIE_SECURE=false in .env quando si usa HTTP (NPM senza SSL)
        secure:
          process.env.NODE_ENV === 'production' &&
          process.env.COOKIE_SECURE !== 'false',
        sameSite: 'lax', // 'strict' se stesso dominio senza cross-origin
        path: '/',
        // domain: '.example.com' se Web e API su sottodomini diversi
      },
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Se l'URL è relativo, usa baseUrl
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      // Se l'URL è dello stesso dominio, permetti
      else if (new URL(url).origin === baseUrl) return url;
      // Altrimenti redirect a dashboard
      return `${baseUrl}/dashboard`;
    },
    async jwt({ token, user, trigger }) {
      // Passa i dati utente al token JWT
      if (user) {
        // Primo login: salva tutti i dati nel token
        const lukeUser = user as unknown as LukeAuthUser;
        token.role = lukeUser.role;
        token.accessToken = lukeUser.accessToken;
        token.firstName = lukeUser.firstName;
        token.lastName = lukeUser.lastName;
        token.locale = lukeUser.locale;
        token.timezone = lukeUser.timezone;
        token.tokenVersion = lukeUser.tokenVersion;
        // Aggiungi claim nbf (not-before) per prevenire uso anticipato
        token.nbf = Math.floor(Date.now() / 1000);
        // Aggiungi claim aud/iss per validazione cross-service
        token.aud = 'luke.web';
        token.iss = 'urn:luke';
      } else if (token.sub && trigger !== 'update') {
        if (checkTokenVersion(token) === null) return null;

        // Refresh token: ri-conia l'accessToken API chiamando auth.refreshToken
        // (con TTL cache). protectedProcedure valida Bearer scaduto e tokenVersion
        // revocato → UNAUTHORIZED → logout. In caso positivo aggiorna l'accessToken
        // embedded, così una sessione NextAuth ancora valida non invia mai un JWT
        // API scaduto (root cause dell'errore `jwt expired`).
        const cached = tokenVersionCache.get(token.sub);
        if (!cached || Date.now() - cached >= TOKEN_VERSION_CACHE_TTL) {
          try {
            const response = await fetch(buildTrpcUrl('auth.refreshToken'), {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({}),
            });

            // Controlla il codice semantico tRPC nel body — più robusto dello status HTTP
            const body = await response.json().catch(() => null);
            if (body?.error?.data?.code === 'UNAUTHORIZED') {
              debugLog('TokenVersion invalido o token scaduto durante refresh JWT, forzo logout');
              tokenVersionCache.delete(token.sub);
              return null; // Forza re-login
            }
            const freshToken = body?.result?.data?.token as string | undefined;
            if (!response.ok || !freshToken) {
              debugError('Errore transitorio refresh token (ignorato):', response.status);
            } else {
              token.accessToken = freshToken;
              tokenVersionCache.set(token.sub, Date.now());
            }
          } catch (error) {
            const isNetworkError = error instanceof TypeError && error.message === 'fetch failed';
            if (!isNetworkError) {
              debugError('Errore verifica tokenVersion durante refresh JWT:', error);
            }
            // In caso di errore di rete, mantieni il token ma logga l'errore
          }
        }

        debugLog('JWT refresh per utente:', token.sub);
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
  // NEXTAUTH_SECRET (env) ha precedenza su getNextAuthSecret() (file system).
  // In prod: l'env var è iniettata dal Docker compose; il fallback al file system è vietato
  // perché il web container non monta il volume ~/.luke/secret.key (API-only).
  // In dev: fallback al file system via getNextAuthSecret() per setup iniziale.
  secret: resolveNextAuthSecret(),
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
