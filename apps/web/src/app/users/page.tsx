'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import Link from 'next/link';

/**
 * Pagina gestione utenti con lista e creazione via tRPC
 * Mostra tabella utenti e form per nuovo utente (placeholder)
 */
export default function UsersPage() {
  const { data: session } = useSession();
  const [showForm, setShowForm] = useState(false);

  // Query tRPC per lista utenti
  const {
    data: users,
    isLoading,
    error,
    refetch,
  } = (trpc as any).users.list.useQuery();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Gestione Utenti</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {session?.user?.name}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Azioni */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Lista Utenti</h2>
              <p className="text-muted-foreground">
                Gestisci gli utenti del sistema
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setShowForm(!showForm)}>
                {showForm ? 'Annulla' : 'Nuovo Utente'}
              </Button>
              <Button variant="outline" onClick={() => refetch()}>
                Aggiorna
              </Button>
            </div>
          </div>

          {/* Form Nuovo Utente (Placeholder) */}
          {showForm && (
            <Card>
              <CardHeader>
                <CardTitle>Nuovo Utente</CardTitle>
                <CardDescription>
                  Form di creazione utente (da implementare)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <p>Form di creazione utente in sviluppo</p>
                  <p className="text-sm mt-2">
                    TODO: Implementare trpc.users.create mutation
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabella Utenti */}
          <Card>
            <CardHeader>
              <CardTitle>Utenti Sistema</CardTitle>
              <CardDescription>
                Lista completa degli utenti registrati
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                  <p>Caricamento utenti...</p>
                </div>
              )}

              {error && (
                <div className="text-center py-8">
                  <div className="text-destructive mb-2">
                    Errore nel caricamento utenti
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    {error.message}
                  </p>
                  <Button variant="outline" onClick={() => refetch()}>
                    Riprova
                  </Button>
                </div>
              )}

              {users && !isLoading && (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Username</TableHead>
                        <TableHead>Ruolo</TableHead>
                        <TableHead>Creato</TableHead>
                        <TableHead>Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center py-8 text-muted-foreground"
                          >
                            Nessun utente trovato
                          </TableCell>
                        </TableRow>
                      ) : (
                        users.map((user: any) => (
                          <TableRow key={user.id}>
                            <TableCell className="font-mono text-sm">
                              {user.id}
                            </TableCell>
                            <TableCell>{user.email}</TableCell>
                            <TableCell>{user.username}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-1 text-xs font-medium">
                                {user.role}
                              </span>
                            </TableCell>
                            <TableCell>
                              {user.createdAt
                                ? new Date(user.createdAt).toLocaleDateString(
                                    'it-IT'
                                  )
                                : 'N/A'}
                            </TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm">
                                Modifica
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Navigazione */}
          <div className="flex gap-2">
            <Link href="/dashboard">
              <Button variant="outline">← Dashboard</Button>
            </Link>
            <Link href="/settings/config">
              <Button variant="outline">Configurazioni →</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
