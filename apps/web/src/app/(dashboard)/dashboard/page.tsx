'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import Link from 'next/link';

/**
 * Pagina dashboard protetta con info sessione
 * Mostra dati utente e link navigazione
 */
export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    router.push('/login');
    return null;
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Luke Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              Benvenuto, {session.user?.name || session.user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Info Sessione */}
          <Card>
            <CardHeader>
              <CardTitle>Informazioni Sessione</CardTitle>
              <CardDescription>Dettagli utente corrente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <span className="font-medium">Nome:</span> {session.user?.name}
              </div>
              <div>
                <span className="font-medium">Email:</span>{' '}
                {session.user?.email}
              </div>
              <div>
                <span className="font-medium">Ruolo:</span>{' '}
                {session.user?.role || 'N/A'}
              </div>
              <div>
                <span className="font-medium">ID:</span> {session.user?.id}
              </div>
            </CardContent>
          </Card>

          {/* Navigazione Rapida */}
          <Card>
            <CardHeader>
              <CardTitle>Navigazione Rapida</CardTitle>
              <CardDescription>Accedi alle sezioni principali</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/users">
                <Button variant="outline" className="w-full justify-start">
                  👥 Gestione Utenti
                </Button>
              </Link>
              <Link href="/settings/config">
                <Button variant="outline" className="w-full justify-start">
                  ⚙️ Configurazioni
                </Button>
              </Link>
              <Link href="/">
                <Button variant="outline" className="w-full justify-start">
                  🏠 Home
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Statistiche (Placeholder) */}
          <Card>
            <CardHeader>
              <CardTitle>Statistiche</CardTitle>
              <CardDescription>Panoramica sistema</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-bold">0</div>
              <div className="text-sm text-muted-foreground">Utenti totali</div>
              <div className="text-2xl font-bold">0</div>
              <div className="text-sm text-muted-foreground">
                Configurazioni
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
