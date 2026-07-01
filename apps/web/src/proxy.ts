import { NextResponse } from 'next/server';

import { buildTrpcUrl } from '@luke/core';

import { auth } from './auth.config';
import { debugError, debugLog } from './lib/debug';

/**
 * Next.js Edge middleware that protects all `/app/*` routes.
 * For authenticated requests it verifies the JWT `tokenVersion` by calling
 * `me.get` on the API — an `401` response forces a redirect to `/login`.
 * Network errors are logged and let the request through to avoid false logouts.
 * Unauthenticated requests are handled automatically by NextAuth.
 *
 * Section-level guards are enforced by server-side layout guards (`assertSectionAccess`)
 * rather than here, to keep this middleware lightweight for the Edge Runtime.
 */
export default auth(async req => {
  const session = req.auth;

  // Se non autenticato, NextAuth gestirà il redirect
  if (!session) {
    return NextResponse.next();
  }

  // Verifica tokenVersion se abbiamo accessToken
  if (session.accessToken) {
    try {
      const response = await fetch(buildTrpcUrl('me.get'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      // Se la chiamata API fallisce (401), il tokenVersion è invalido
      if (!response.ok) {
        debugLog('TokenVersion invalido, redirect a login');
        return NextResponse.redirect(new URL('/login', req.url));
      }
    } catch (error) {
      debugError('Errore verifica tokenVersion:', error);
      // In caso di errore di rete, permetti l'accesso ma logga l'errore
    }
  }

  // Protezione route admin-only ora gestita dai layout guards server-side
  // Il controllo hard-coded è stato rimosso in favore di controlli granulari per sezione

  return NextResponse.next();
});

// Configurazione matcher per proteggere solo le rotte del dashboard
export const config = {
  matcher: ['/(app)(.*)'],
};
