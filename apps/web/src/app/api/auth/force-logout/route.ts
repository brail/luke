import { signOut } from '../../../../auth';

/**
 * Clears the NextAuth session cookie server-side and redirects to `/login`.
 * Server Components (e.g. `assertSectionAccess`) cannot mutate cookies during
 * render, so a stale/revoked session detected there is routed here instead of
 * a bare `redirect('/login')`, which would leave the dead cookie behind.
 * @auth {public}
 */
export async function GET() {
  await signOut({ redirectTo: '/login' });
}
