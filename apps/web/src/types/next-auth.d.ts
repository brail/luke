import 'next-auth';

// eslint-disable-next-line no-unused-vars
declare module 'next-auth' {
  // eslint-disable-next-line no-unused-vars
  interface User {
    role?: string;
    firstName?: string;
    lastName?: string;
    tokenVersion?: number;
  }

  // eslint-disable-next-line no-unused-vars
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
      firstName?: string;
      lastName?: string;
      tokenVersion?: number;
    };
    accessToken?: string;
  }
}

// eslint-disable-next-line no-unused-vars
declare module 'next-auth/jwt' {
  // eslint-disable-next-line no-unused-vars
  interface JWT {
    role?: string;
    accessToken?: string;
    firstName?: string;
    lastName?: string;
    tokenVersion?: number;
  }
}
