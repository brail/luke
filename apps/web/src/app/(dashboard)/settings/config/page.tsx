'use client';

import React, { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '../../../../lib/trpc';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import Link from 'next/link';

/**
 * Pagina gestione configurazioni con lista e creazione via tRPC
 * Mostra tabella configurazioni e form per nuove configurazioni
 */
export default function ConfigPage() {
  const { data: session } = useSession();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [encrypt, setEncrypt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Query tRPC per lista configurazioni
  const {
    data: configs,
    isLoading,
    error,
    refetch,
  } = (trpc as any).config.list.useQuery({
    decrypt: true,
  });

  // Mutation tRPC per salvare configurazione
  const { mutateAsync: setConfig } = (trpc as any).config.set.useMutation();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || !value.trim()) return;

    setIsSubmitting(true);
    try {
      await setConfig({
        key: key.trim(),
        value: value.trim(),
        encrypt,
      });
      await refetch();
      setKey('');
      setValue('');
      setEncrypt(false);
    } catch (err) {
      console.error('Errore salvataggio configurazione:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Configurazioni</h1>
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
          {/* Form Nuova Configurazione */}
          <Card>
            <CardHeader>
              <CardTitle>Nuova Configurazione</CardTitle>
              <CardDescription>
                Aggiungi una nuova configurazione al sistema
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="key">Chiave</Label>
                    <Input
                      id="key"
                      placeholder="es. database.host"
                      value={key}
                      onChange={e => setKey(e.target.value)}
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="value">Valore</Label>
                    <Input
                      id="value"
                      placeholder="es. localhost:5432"
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="encrypt"
                    checked={encrypt}
                    onChange={e => setEncrypt(e.target.checked)}
                    disabled={isSubmitting}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="encrypt" className="text-sm">
                    Cifra il valore (AES-256-GCM)
                  </Label>
                </div>
                <Button
                  type="submit"
                  disabled={isSubmitting || !key.trim() || !value.trim()}
                >
                  {isSubmitting ? 'Salvataggio...' : 'Salva Configurazione'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Tabella Configurazioni */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Configurazioni Sistema</CardTitle>
                  <CardDescription>
                    Lista completa delle configurazioni
                  </CardDescription>
                </div>
                <Button variant="outline" onClick={() => refetch()}>
                  Aggiorna
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading && (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                  <p>Caricamento configurazioni...</p>
                </div>
              )}

              {error && (
                <div className="text-center py-8">
                  <div className="text-destructive mb-2">
                    Errore nel caricamento configurazioni
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    {error.message}
                  </p>
                  <Button variant="outline" onClick={() => refetch()}>
                    Riprova
                  </Button>
                </div>
              )}

              {configs && !isLoading && (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Chiave</TableHead>
                        <TableHead>Valore</TableHead>
                        <TableHead>Cifrato</TableHead>
                        <TableHead>Aggiornato</TableHead>
                        <TableHead>Azioni</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configs.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-8 text-muted-foreground"
                          >
                            Nessuna configurazione trovata
                          </TableCell>
                        </TableRow>
                      ) : (
                        configs.map((config: any) => (
                          <TableRow key={config.key}>
                            <TableCell className="font-mono text-sm">
                              {config.key}
                            </TableCell>
                            <TableCell
                              className="max-w-xs truncate"
                              title={config.value}
                            >
                              {config.value}
                            </TableCell>
                            <TableCell>
                              {config.isEncrypted ? (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">
                                  ✅ Cifrato
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800">
                                  — Normale
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {config.updatedAt
                                ? new Date(config.updatedAt).toLocaleDateString(
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
          <div className="flex gap-2 flex-wrap">
            <Link href="/dashboard">
              <Button variant="outline">← Dashboard</Button>
            </Link>
            <Link href="/users">
              <Button variant="outline">Utenti →</Button>
            </Link>
            <Link href="/settings/ldap">
              <Button variant="outline">LDAP →</Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
