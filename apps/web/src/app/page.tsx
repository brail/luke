import { redirect } from 'next/navigation';

import { auth } from '../auth';

/**
 * Root page with an automatic redirect based on the authentication state.
 * A Server Component, to avoid flickering and improve the UX.
 */
export default async function Home() {
  const session = await auth();

  if (session) {
    // Authenticated user: redirect to the dashboard
    redirect('/dashboard');
  } else {
    // Unauthenticated user: redirect to login
    redirect('/login');
  }
}
