import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { getNextAuthSecret } from '@luke/core/server';

import type { NextAuthConfig } from 'next-auth';

/**
 * Helper per chiamare l'API tRPC
 */
async function callTRPCAuth(username: string, password: string) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/trpc/auth.login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.result?.data;
  } catch (error) {
    console.error('Errore chiamata API auth:', error);
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
          console.error('Errore autenticazione:', error);
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
        secure: process.env.NODE_ENV === 'production',
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
          console.log('JWT senza tokenVersion, forzo logout');
          return null;
        }

        // Refresh token: verifica tokenVersion chiamando API
        try {
          const apiUrl =
            process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
          const response = await fetch(`${apiUrl}/trpc/me.get`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              'Content-Type': 'application/json',
            },
          });

          // Se la chiamata API fallisce (401), il tokenVersion è invalido
          if (!response.ok) {
            console.log(
              'TokenVersion invalido durante refresh JWT, forzo logout'
            );
            return null; // Forza re-login
          }
        } catch (error) {
          console.error(
            'Errore verifica tokenVersion durante refresh JWT:',
            error
          );
          // In caso di errore di rete, mantieni il token ma logga l'errore
        }

        console.log('JWT refresh per utente:', token.sub);
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
  // Secret derivato deterministicamente dalla master key via HKDF-SHA256
  // Nessuna esposizione HTTP, nessun valore in database
  secret: getNextAuthSecret(),
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
