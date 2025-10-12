import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';

/**
 * Configurazione Auth.js v5 per Luke
 * Provider Credentials con placeholder per autenticazione
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
          // Per ora, autenticazione semplificata
          // TODO: Implementare chiamata diretta al database o API endpoint
          if (
            credentials.username === 'admin' &&
            credentials.password === 'admin'
          ) {
            return {
              id: 'admin-user-id',
              name: 'admin',
              email: 'admin@luke.local',
              role: 'admin',
            };
          }

          // Per test, accetta anche altri utenti con password "password"
          if (credentials.password === 'password') {
            return {
              id: `user-${credentials.username}`,
              name: credentials.username as string,
              email: `${credentials.username}@luke.local`,
              role: 'editor',
            };
          }

          return null;
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
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      // Passa i dati dal token alla sessione
      if (token) {
        session.user.id = token.sub || '';
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET || 'CHANGE_ME_IN_PRODUCTION',
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
