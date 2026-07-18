import { NextResponse } from 'next/server';

/**
 * Next.js Edge middleware that protects all `/app/*` routes.
 * Unauthenticated requests are handled client-side (`(app)/layout.tsx`), not here.
 *
 * Used to also re-verify the embedded API accessToken against `me.get` on every
 * request, but that check raced ahead of the Node-side refresh in `auth.ts`'s
 * `jwt` callback (which keeps the token fresh via `auth.refreshToken`), forcing
 * a logout every time the 8h token went stale even though the NextAuth session
 * was still valid. tokenVersion/expiry is already re-enforced on every real
 * tRPC call via `authMiddleware`, and revocation propagates within 60s via
 * `HeartbeatTicker` — so this is now a plain passthrough rather than wrapping
 * `auth()`, which would otherwise decode/verify the session JWT on every
 * request for a result nothing here reads.
 *
 * Section-level guards are enforced by server-side layout guards (`assertSectionAccess`)
 * rather than here, to keep this middleware lightweight for the Edge Runtime.
 */
export default function middleware() {
  return NextResponse.next();
}

// Configurazione matcher per proteggere solo le rotte del dashboard
export const config = {
  matcher: ['/(app)(.*)'],
};
