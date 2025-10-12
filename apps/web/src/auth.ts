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
        // TODO: Integrare con tRPC per verificare credenziali reali
        // Per ora accetta qualsiasi login e restituisce utente admin
        if (!credentials?.username) {
          return null;
        }

        // Placeholder: in produzione chiamare trpc.users.authenticate
        return {
          id: 'temp-user-id',
          name: credentials.username as string,
          email: `${credentials.username}@local`,
          role: 'admin',
        };
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
