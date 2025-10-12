'use client';

import { useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { trpc } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
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
import { UserDialog } from '../../components/UserDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { toast } from 'sonner';
import Link from 'next/link';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * Pagina gestione utenti con CRUD completo
 * Include lista paginata, filtri, creazione, modifica e eliminazione utenti
 */
export default function UsersPage() {
  const { data: session } = useSession();

  // Stato per dialog e paginazione
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');

  // Stato per modal di conferma
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'disable' | 'hardDelete';
    user: any;
    handler: () => void;
  } | null>(null);

  // Stato per ordinamento
  const [sortBy, setSortBy] = useState<
    'email' | 'username' | 'role' | 'isActive' | 'createdAt'
  >('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Query tRPC per lista utenti con paginazione e filtri
  const {
    data: usersData,
    isLoading,
    error,
    refetch,
  } = (trpc as any).users.list.useQuery({
    page: currentPage,
    limit: 10,
    search: searchTerm || undefined,
    role: roleFilter || undefined,
    sortBy,
    sortOrder,
  });

  // Mutations tRPC
  const createUserMutation = (trpc as any).users.create.useMutation({
    onSuccess: () => {
      toast.success('Utente creato con successo');
      setDialogOpen(false);
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nella creazione: ${error.message}`);
    },
  });

  const updateUserMutation = (trpc as any).users.update.useMutation({
    onSuccess: () => {
      toast.success('Utente aggiornato con successo');
      setDialogOpen(false);
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nell'aggiornamento: ${error.message}`);
    },
  });

  const deleteUserMutation = (trpc as any).users.delete.useMutation({
    onSuccess: () => {
      toast.success('Utente disattivato con successo');
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nella disattivazione: ${error.message}`);
    },
  });

  const hardDeleteUserMutation = (trpc as any).users.hardDelete.useMutation({
    onSuccess: () => {
      toast.success('Utente eliminato definitivamente');
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nell'eliminazione: ${error.message}`);
    },
  });

  // Handlers per le azioni
  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const handleCreateUser = () => {
    setDialogMode('create');
    setSelectedUser(null);
    setDialogOpen(true);
  };

  const handleEditUser = (user: any) => {
    setDialogMode('edit');
    setSelectedUser(user);
    setDialogOpen(true);
  };

  const handleDeleteUser = (user: any) => {
    setConfirmAction({
      type: 'disable',
      user,
      handler: () => deleteUserMutation.mutate({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleHardDeleteUser = (user: any) => {
    setConfirmAction({
      type: 'hardDelete',
      user,
      handler: () => hardDeleteUserMutation.mutate({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleConfirmAction = () => {
    if (confirmAction) {
      confirmAction.handler();
    }
  };

  const handleSort = (
    column: 'email' | 'username' | 'role' | 'isActive' | 'createdAt'
  ) => {
    if (sortBy === column) {
      // Se è la stessa colonna, inverte l'ordinamento
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Se è una nuova colonna, imposta come ascendente
      setSortBy(column);
      setSortOrder('asc');
    }
    // Reset alla prima pagina quando si cambia ordinamento
    setCurrentPage(1);
  };

  // Componente helper per header ordinabile
  const SortableHeader = ({
    column,
    children,
  }: {
    column: 'email' | 'username' | 'role' | 'isActive' | 'createdAt';
    children: React.ReactNode;
  }) => {
    const isActive = sortBy === column;
    const getSortIcon = () => {
      if (!isActive)
        return <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />;
      return sortOrder === 'asc' ? (
        <ChevronUp className="h-4 w-4 text-primary" />
      ) : (
        <ChevronDown className="h-4 w-4 text-primary" />
      );
    };

    return (
      <TableHead
        className="cursor-pointer hover:bg-muted/50 select-none"
        onClick={() => handleSort(column)}
      >
        <div className="flex items-center gap-2">
          {children}
          {getSortIcon()}
        </div>
      </TableHead>
    );
  };

  const handleFormSubmit = (data: any) => {
    if (dialogMode === 'create') {
      createUserMutation.mutate(data);
    } else {
      updateUserMutation.mutate({ id: selectedUser.id, ...data });
    }
  };

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset alla prima pagina
  };

  const handleRoleFilter = (value: string) => {
    setRoleFilter(value);
    setCurrentPage(1); // Reset alla prima pagina
  };

  const users = usersData?.users || [];
  const totalPages = usersData?.totalPages || 0;

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
          {/* Azioni e Filtri */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Lista Utenti</h2>
              <p className="text-muted-foreground">
                Gestisci gli utenti del sistema
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateUser}>Nuovo Utente</Button>
              <Button variant="outline" onClick={() => refetch()}>
                Aggiorna
              </Button>
            </div>
          </div>

          {/* Filtri */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4 items-center">
                <div className="flex-1">
                  <Input
                    placeholder="Cerca per email o username..."
                    value={searchTerm}
                    onChange={e => handleSearch(e.target.value)}
                  />
                </div>
                <div>
                  <select
                    value={roleFilter}
                    onChange={e => handleRoleFilter(e.target.value)}
                    className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Tutti i ruoli</option>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

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
                        <SortableHeader column="email">Email</SortableHeader>
                        <SortableHeader column="username">
                          Username
                        </SortableHeader>
                        <SortableHeader column="role">Ruolo</SortableHeader>
                        <SortableHeader column="isActive">Stato</SortableHeader>
                        <SortableHeader column="createdAt">
                          Creato
                        </SortableHeader>
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
                            <TableCell>{user.email}</TableCell>
                            <TableCell>{user.username}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-1 text-xs font-medium">
                                {user.role}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                  user.isActive
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {user.isActive ? 'Attivo' : 'Disattivo'}
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
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditUser(user)}
                                >
                                  Modifica
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteUser(user)}
                                  disabled={!user.isActive}
                                >
                                  Disattiva
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleHardDeleteUser(user)}
                                >
                                  Elimina
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Paginazione */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center pt-4">
                  <div className="text-sm text-muted-foreground">
                    Pagina {currentPage} di {totalPages} (
                    {usersData?.total || 0} utenti totali)
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage(prev => Math.max(1, prev - 1))
                      }
                      disabled={currentPage === 1}
                    >
                      Precedente
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage(prev => Math.min(totalPages, prev + 1))
                      }
                      disabled={currentPage === totalPages}
                    >
                      Successiva
                    </Button>
                  </div>
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

      {/* User Dialog */}
      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        user={selectedUser}
        onSubmit={handleFormSubmit}
        isLoading={createUserMutation.isPending || updateUserMutation.isPending}
      />

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          open={confirmDialogOpen}
          onOpenChange={setConfirmDialogOpen}
          title={
            confirmAction.type === 'disable'
              ? 'Disattiva Utente'
              : confirmAction.type === 'hardDelete'
                ? 'Elimina Definitivamente'
                : 'Conferma Azione'
          }
          description={
            confirmAction.type === 'disable'
              ? "L'utente non potrà più accedere al sistema. L'operazione può essere annullata riattivando l'utente."
              : confirmAction.type === 'hardDelete'
                ? "Questa operazione è irreversibile. Tutti i dati dell'utente verranno eliminati permanentemente dal database."
                : 'Sei sicuro di voler procedere con questa azione?'
          }
          confirmText={
            confirmAction.type === 'disable'
              ? 'Disattiva'
              : confirmAction.type === 'hardDelete'
                ? 'Elimina Definitivamente'
                : 'Conferma'
          }
          cancelText="Annulla"
          variant="destructive"
          onConfirm={handleConfirmAction}
          isLoading={
            deleteUserMutation.isPending || hardDeleteUserMutation.isPending
          }
          userEmail={confirmAction.user?.email}
          actionType={confirmAction.type}
        />
      )}
    </div>
  );
}
