import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';


import { buildTrpcUrl } from '@luke/core';
import { getNextAuthSecret } from '@luke/core/server';

import { debugError, debugLog } from './lib/debug';

import type { NextAuthConfig } from 'next-auth';

// Forza runtime Node.js: necessari moduli Node in @luke/core/server
export const runtime = 'nodejs';

/**
 * Helper per chiamare l'API tRPC
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
 * Configurazione Auth.js v5 per Luke
 * Integrata con il sistema di autenticazione tRPC
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
    maxAge: 8 * 60 * 60, // 8 ore
    updateAge: 4 * 60 * 60, // Refresh ogni 4 ore (50% lifetime)
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
        token.role = (user as any).role;
        token.accessToken = (user as any).accessToken;
        token.firstName = (user as any).firstName;
        token.lastName = (user as any).lastName;
        token.locale = (user as any).locale;
        token.timezone = (user as any).timezone;
        token.tokenVersion = (user as any).tokenVersion;
        // Aggiungi claim nbf (not-before) per prevenire uso anticipato
        token.nbf = Math.floor(Date.now() / 1000);
        // Aggiungi claim aud/iss per validazione cross-service
        token.aud = 'luke.web';
        token.iss = 'urn:luke';
      } else if (token.sub && trigger !== 'update') {
        // Se tokenVersion manca, forza re-login (opzione 1b)
        if (token.tokenVersion === undefined || token.tokenVersion === null) {
          debugLog('JWT senza tokenVersion, forzo logout');
          return null;
        }

        // Refresh token: verifica tokenVersion chiamando API
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
            return null; // Forza re-login
          }
          if (!response.ok) {
            debugError('Errore transitorio verifica tokenVersion (ignorato):', response.status);
          }
        } catch (error) {
          debugError('Errore verifica tokenVersion durante refresh JWT:', error);
          // In caso di errore di rete, mantieni il token ma logga l'errore
        }

        debugLog('JWT refresh per utente:', token.sub);
      }
      return token;
    },
    async session({ session, token }) {
      // Passa i dati dal token alla sessione
      if (token) {
        session.user.id = token.sub || '';
        session.user.role = token.role as string;
        session.user.firstName = token.firstName as string;
        session.user.lastName = token.lastName as string;
        session.user.locale = token.locale as string;
        session.user.timezone = token.timezone as string;
        session.user.tokenVersion = token.tokenVersion as number;
        session.accessToken = token.accessToken as string;
      }
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
  // Secret derivato deterministicamente dalla master key via HKDF-SHA256
  // Nessuna esposizione HTTP, nessun valore in database
  secret: getNextAuthSecret(),
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
