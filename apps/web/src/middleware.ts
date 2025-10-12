import { auth } from './auth';
import { NextResponse } from 'next/server';

/**
 * Middleware per proteggere le rotte del dashboard
 * NextAuth gestisce automaticamente il redirect a /login se non autenticato
 */
export default auth(() => {
  // Il middleware viene eseguito solo per le rotte che corrispondono al matcher
  // NextAuth gestisce automaticamente l'autenticazione e i redirect
  return NextResponse.next();
});

// Configurazione matcher per proteggere solo le rotte del dashboard
export const config = {
  matcher: ['/(dashboard)(.*)'],
};
