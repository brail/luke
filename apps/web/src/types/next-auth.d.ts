import 'next-auth';

// eslint-disable-next-line no-unused-vars
declare module 'next-auth' {
  // eslint-disable-next-line no-unused-vars
  interface User {
    role?: string;
  }

  // eslint-disable-next-line no-unused-vars
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
    };
  }
}

// eslint-disable-next-line no-unused-vars
declare module 'next-auth/jwt' {
  // eslint-disable-next-line no-unused-vars
  interface JWT {
    role?: string;
  }
}
