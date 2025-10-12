import { auth } from '../auth';
import { redirect } from 'next/navigation';

/**
 * Root page con redirect automatico basato sullo stato di autenticazione
 * Server Component per evitare flickering e migliorare la UX
 */
export default async function Home() {
  const session = await auth();

  if (session) {
    // Utente autenticato: redirect alla dashboard
    redirect('/dashboard');
  } else {
    // Utente non autenticato: redirect al login
    redirect('/login');
  }
}
