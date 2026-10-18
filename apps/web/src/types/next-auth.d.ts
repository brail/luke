import 'next-auth';

declare module 'next-auth' {
  interface User {
    role?: string;
    firstName?: string;
    lastName?: string;
    locale?: string;
    timezone?: string;
    tokenVersion?: number;
  }

  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
      firstName?: string;
      lastName?: string;
      locale?: string;
      timezone?: string;
      tokenVersion?: number;
    };
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: string;
    accessToken?: string;
    firstName?: string;
    lastName?: string;
    locale?: string;
    timezone?: string;
    tokenVersion?: number;
    nbf?: number; // not-before claim
    aud?: string; // audience claim
    iss?: string; // issuer claim
  }
}
