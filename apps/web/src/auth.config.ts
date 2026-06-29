import NextAuth from 'next-auth';

import { checkTokenVersion, populateSession, SESSION_MAX_AGE, SESSION_UPDATE_AGE } from './auth.shared';

import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-compatible Auth.js configuration used exclusively by `middleware.ts`.
 * Contains no Node.js modules (no providers, no `@luke/core/server` imports).
 * The `jwt` callback checks `tokenVersion` presence and the `session` callback
 * populates the session shape. The full provider config lives in `auth.ts`.
 */
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
