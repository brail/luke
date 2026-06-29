import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { buildTrpcUrl } from '@luke/core';
import { getNextAuthSecret } from '@luke/core/server';

import { checkTokenVersion, populateSession, SESSION_MAX_AGE, SESSION_UPDATE_AGE } from './auth.shared';
import { debugError, debugLog } from './lib/debug';

import type { NextAuthConfig } from 'next-auth';

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
 * Calls the `auth.login` tRPC endpoint and returns the raw API response data,
 * or a `{ pendingApproval, needsEmail }` object for accounts awaiting approval.
 * Returns `null` on any error or non-OK response.
 */
async function callTRPCAuth(username: string, password: string) {
  try {
    const response = await fetch(buildTrpcUrl('auth.login'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        try {
          // Chiama l'API tRPC per l'autenticazione
          const authResult = await callTRPCAuth(
            credentials.username as string,
            credentials.password as string
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

        // Refresh token: verifica tokenVersion chiamando API (con TTL cache)
        const cached = tokenVersionCache.get(token.sub);
        if (!cached || Date.now() - cached >= TOKEN_VERSION_CACHE_TTL) {
          try {
            const response = await fetch(buildTrpcUrl('me.get'), {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${token.accessToken}`,
                'Content-Type': 'application/json',
              },
            });

            // Controlla il codice semantico tRPC nel body — più robusto dello status HTTP
            const body = await response.json().catch(() => null);
            if (body?.error?.data?.code === 'UNAUTHORIZED') {
              debugLog('TokenVersion invalido durante refresh JWT, forzo logout');
              tokenVersionCache.delete(token.sub);
              return null; // Forza re-login
            }
            if (!response.ok) {
              debugError('Errore transitorio verifica tokenVersion (ignorato):', response.status);
            } else {
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
  // In prod il web container non ha accesso a ~/.luke/secret.key (volume API-only);
  // l'env var viene iniettata dal Docker compose con il valore derivato dalla master key.
  // In dev: impostato in .env.local via `getNextAuthSecret()` al setup iniziale.
  secret: process.env.NEXTAUTH_SECRET ?? getNextAuthSecret(),
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
