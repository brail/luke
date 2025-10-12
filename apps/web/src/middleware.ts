import { auth } from './auth';
import { NextResponse } from 'next/server';

/**
 * Middleware per proteggere le rotte autenticate
 * Redirect automatico a /login se non autenticato
 */
export default auth(req => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Rotte protette che richiedono autenticazione
  const protectedRoutes = ['/dashboard', '/users', '/settings'];
  const isProtectedRoute = protectedRoutes.some(route =>
    nextUrl.pathname.startsWith(route)
  );

  // Se è una rotta protetta e l'utente non è autenticato
  if (isProtectedRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', nextUrl));
  }

  // Se è sulla pagina login e l'utente è già autenticato, redirect a dashboard
  if (nextUrl.pathname === '/login' && isLoggedIn) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl));
  }

  return NextResponse.next();
});

// Configurazione matcher per evitare loop su API routes e file statici
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
