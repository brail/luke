import { NextResponse } from 'next/server';

import { buildTrpcUrl } from '@luke/core';

import { auth } from './auth';

/**
 * Middleware per proteggere le rotte del dashboard
 * NextAuth gestisce automaticamente il redirect a /login se non autenticato
 * Protezione aggiuntiva per route admin-only
 * Verifica tokenVersion per invalidazione sessioni
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
        console.log('TokenVersion invalido, redirect a login');
        return NextResponse.redirect(new URL('/login', req.url));
      }
    } catch (error) {
      console.error('Errore verifica tokenVersion:', error);
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
