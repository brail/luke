import NextAuth from 'next-auth';

import { checkTokenVersion, populateSession, SESSION_MAX_AGE, SESSION_UPDATE_AGE } from './auth.shared';

import type { NextAuthConfig } from 'next-auth';

// Edge-compatible auth config — no Node.js modules, secret from NEXTAUTH_SECRET env var.
// Used by middleware (Edge Runtime). Full auth config with providers lives in auth.ts.
export const edgeAuthConfig = {
  providers: [],
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE,
    updateAge: SESSION_UPDATE_AGE,
  },
  callbacks: {
    async jwt({ token, trigger }) {
      if (!token.sub || trigger === 'update') return token;
      return checkTokenVersion(token);
    },
    async session({ session, token }) {
      if (token) populateSession(session, token);
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  trustHost: true,
} satisfies NextAuthConfig;

export const { auth } = NextAuth(edgeAuthConfig);
