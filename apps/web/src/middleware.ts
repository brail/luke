import { auth } from './auth';
import { NextResponse } from 'next/server';

/**
 * Middleware per proteggere le rotte del dashboard
 * NextAuth gestisce automaticamente il redirect a /login se non autenticato
 * Protezione aggiuntiva per route admin-only
 */
export default auth(req => {
  const { pathname } = req.nextUrl;

  // Protezione route admin-only
  if (pathname.startsWith('/settings/')) {
    const session = req.auth;

    // Se non autenticato, NextAuth gestirà il redirect
    if (!session) {
      return NextResponse.next();
    }

    // Se autenticato ma non admin, nega accesso
    if (session.user?.role !== 'admin') {
      return new NextResponse(
        JSON.stringify({
          error: 'Accesso negato: richiesto ruolo admin',
          message: 'Solo gli amministratori possono accedere alle impostazioni',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  return NextResponse.next();
});

// Configurazione matcher per proteggere solo le rotte del dashboard
export const config = {
  matcher: ['/(app)(.*)'],
};
