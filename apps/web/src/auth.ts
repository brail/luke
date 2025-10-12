import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
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
 * Recupera il NextAuth secret dall'API
 * Fallback a variabile d'ambiente per sviluppo
 */
async function getNextAuthSecret(): Promise<string> {
  try {
    // In produzione, recupera il segreto dall'API
    if (process.env.NODE_ENV === 'production') {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/nextauth-secret`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return data.secret;
      }
    }
  } catch (error) {
    console.warn("Impossibile recuperare NextAuth secret dall'API:", error);
  }

  // Fallback per sviluppo o se l'API non è disponibile
  return process.env.NEXTAUTH_SECRET || 'CHANGE_ME_IN_PRODUCTION';
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
            role: authResult.user.role,
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
      }
      return token;
    },
    async session({ session, token }) {
      // Passa i dati dal token alla sessione
      if (token) {
        session.user.id = token.sub || '';
        session.user.role = token.role as string;
        session.accessToken = token.accessToken as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: await getNextAuthSecret(),
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
