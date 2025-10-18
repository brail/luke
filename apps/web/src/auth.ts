import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';
import { getNextAuthSecret } from '@luke/core/server';

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
  },
  callbacks: {
    async jwt({ token, user }) {
      // Passa i dati utente al token JWT
      if (user) {
        token.role = (user as any).role;
        token.accessToken = (user as any).accessToken;
        token.firstName = (user as any).firstName;
        token.lastName = (user as any).lastName;
        token.tokenVersion = (user as any).tokenVersion;
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
