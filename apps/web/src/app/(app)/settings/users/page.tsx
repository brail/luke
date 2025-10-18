'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '../../../../lib/trpc';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { UserDialog } from '../../../../components/UserDialog';
import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { toast } from 'sonner';
import React from 'react';
import { debugLog } from '../../../../lib/debug';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
  Edit,
  UserX,
  Trash2,
  LogOut,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu';

/**
 * Pagina gestione utenti con CRUD completo
 * Include lista paginata, filtri, creazione, modifica e eliminazione utenti
 * Layout e header gestiti dal layout padre
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
  const [syncedFields, setSyncedFields] = useState<
    ('email' | 'username' | 'firstName' | 'lastName' | 'role' | 'password')[]
  >([]);

  // Stato per modal di conferma
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'disable' | 'hardDelete' | 'revokeSessions';
    user: any;
    handler: () => void;
  } | null>(null);

  // Stato per ordinamento
  const [sortBy, setSortBy] = useState<
    | 'email'
    | 'username'
    | 'firstName'
    | 'lastName'
    | 'role'
    | 'isActive'
    | 'createdAt'
    | 'provider'
  >('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Query tRPC per lista utenti con paginazione e filtri
  const {
    data: usersData,
    isLoading,
    error,
    refetch,
  } = trpc.users.list.useQuery(
    {
      page: currentPage,
      limit: 10,
      search: searchTerm || undefined,
      role: (roleFilter as 'admin' | 'editor' | 'viewer') || undefined,
      sortBy,
      sortOrder,
    },
    {
      enabled: !!session?.accessToken, // Aspetta che la sessione sia caricata
    }
  );

  // Mutations tRPC
  const createUserMutation = trpc.users.create.useMutation({
    onSuccess: () => {
      toast.success('Utente creato con successo');
      setDialogOpen(false);
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nella creazione: ${error.message}`);
    },
  });

  const revokeUserSessionsMutation = trpc.users.revokeUserSessions.useMutation({
    onSuccess: data => {
      toast.success(data.message);
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nella revoca sessioni: ${error.message}`);
    },
  });

  const updateUserMutation = trpc.users.update.useMutation({
    onSuccess: () => {
      toast.success('Utente aggiornato con successo');
      setDialogOpen(false);
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nell'aggiornamento: ${error.message}`);
    },
  });

  const deleteUserMutation = trpc.users['delete'].useMutation({
    onSuccess: () => {
      toast.success('Utente disattivato con successo');
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nella disattivazione: ${error.message}`);
    },
  });

  const hardDeleteUserMutation = trpc.users.hardDelete.useMutation({
    onSuccess: () => {
      toast.success('Utente eliminato definitivamente');
      refetch();
    },
    onError: (error: any) => {
      toast.error(`Errore nell'eliminazione: ${error.message}`);
    },
  });

  // Handlers per le azioni

  const handleCreateUser = () => {
    setDialogMode('create');
    setSelectedUser(null);
    setSyncedFields([]); // Nuovo utente = nessun campo sincronizzato
    setDialogOpen(true);
  };

  const handleEditUser = (user: any) => {
    setDialogMode('edit');
    setSelectedUser(user);
    // Determina campi sincronizzati in base al provider
    // Per provider esterni (LDAP, OIDC): blocca username, firstName, lastName e password
    // email e ruolo sono modificabili anche per utenti esterni
    const synced: (
      | 'email'
      | 'username'
      | 'firstName'
      | 'lastName'
      | 'role'
      | 'password'
    )[] =
      user?.identities?.[0]?.provider !== 'LOCAL'
        ? ['username', 'firstName', 'lastName', 'password']
        : [];
    setSyncedFields(synced);
    setDialogOpen(true);
  };

  const handleDeleteUser = (user: any) => {
    // Debug: verifica i valori
    debugLog('handleDeleteUser - user.id:', user.id);
    debugLog('handleDeleteUser - session.user.id:', session?.user?.id);
    debugLog('handleDeleteUser - isSelf:', user.id === session?.user?.id);

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

  const handleRevokeUserSessions = (user: any) => {
    // Protezione: impedisci auto-revoca
    if (user.id === session?.user?.id) {
      toast.error(
        'Non puoi revocare le tue stesse sessioni da qui. Usa il profilo personale.'
      );
      return;
    }

    // Conferma prima di procedere
    setConfirmAction({
      type: 'revokeSessions',
      user,
      handler: () => revokeUserSessionsMutation.mutate({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleSort = (
    column:
      | 'email'
      | 'username'
      | 'firstName'
      | 'lastName'
      | 'role'
      | 'isActive'
      | 'createdAt'
      | 'provider'
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
    column:
      | 'email'
      | 'username'
      | 'firstName'
      | 'lastName'
      | 'role'
      | 'isActive'
      | 'createdAt'
      | 'provider';
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
      // Filtra i campi per self-edit
      const isSelfEdit = selectedUser?.id === session?.user?.id;
      const updateData: any = { id: selectedUser.id };

      // Aggiungi solo i campi modificati
      if (data.email !== selectedUser.email) updateData.email = data.email;
      if (data.username !== selectedUser.username)
        updateData.username = data.username;
      if (data.firstName !== selectedUser.firstName)
        updateData.firstName = data.firstName;
      if (data.lastName !== selectedUser.lastName)
        updateData.lastName = data.lastName;
      if (data.isActive !== selectedUser.isActive)
        updateData.isActive = data.isActive;

      // Password solo se non vuota
      if (data.password && data.password.trim() !== '') {
        updateData.password = data.password;
      }

      // Ruolo solo se non è self-edit
      if (!isSelfEdit && data.role !== selectedUser.role) {
        updateData.role = data.role;
      }

      updateUserMutation.mutate(updateData);
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
    <div className="space-y-6">
      <PageHeader
        title="Gestione Utenti"
        description="Gestisci gli utenti del sistema"
      />

      {/* Azioni e Filtri */}
      <SectionCard
        title="Ricerca e Filtri"
        description="Cerca e filtra gli utenti del sistema"
      >
        <div className="flex gap-4 items-center mb-4">
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
        <div className="flex gap-2">
          <Button onClick={handleCreateUser}>Nuovo Utente</Button>
          <Button variant="outline" onClick={() => refetch()}>
            Aggiorna
          </Button>
        </div>
      </SectionCard>

      {/* Tabella Utenti */}
      <SectionCard
        title="Utenti Sistema"
        description="Lista completa degli utenti registrati"
      >
        {!session?.accessToken && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p>Caricamento sessione...</p>
          </div>
        )}

        {isLoading && session?.accessToken && (
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

        {users && !isLoading && session?.accessToken && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader column="email">Email</SortableHeader>
                  <SortableHeader column="username">Username</SortableHeader>
                  <SortableHeader column="firstName">Nome</SortableHeader>
                  <SortableHeader column="lastName">Cognome</SortableHeader>
                  <SortableHeader column="provider">Provider</SortableHeader>
                  <SortableHeader column="role">Ruolo</SortableHeader>
                  <SortableHeader column="isActive">Stato</SortableHeader>
                  <SortableHeader column="createdAt">Creato</SortableHeader>
                  <TableHead>Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
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
                      <TableCell>{user.firstName || '-'}</TableCell>
                      <TableCell>{user.lastName || '-'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium">
                          {user.identities?.[0]?.provider || 'LOCAL'}
                        </span>
                      </TableCell>
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
                          ? new Date(user.createdAt).toLocaleDateString('it-IT')
                          : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                            >
                              <span className="sr-only">Apri menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleEditUser(user)}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Modifica
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                // Doppia protezione: controlla anche qui prima di procedere
                                if (user.id === session?.user?.id) {
                                  toast.error(
                                    'Non puoi disattivare il tuo stesso account'
                                  );
                                  return;
                                }
                                handleDeleteUser(user);
                              }}
                              disabled={
                                !user.isActive || user.id === session?.user?.id
                              }
                            >
                              <UserX className="mr-2 h-4 w-4" />
                              Disattiva
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleRevokeUserSessions(user)}
                              className="text-orange-600 focus:text-orange-600"
                            >
                              <LogOut className="mr-2 h-4 w-4" />
                              Logout da tutti i dispositivi
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                // Doppia protezione: controlla anche qui prima di procedere
                                if (user.id === session?.user?.id) {
                                  toast.error(
                                    'Non puoi eliminare il tuo stesso account'
                                  );
                                  return;
                                }
                                handleHardDeleteUser(user);
                              }}
                              disabled={user.id === session?.user?.id}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Elimina
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Paginazione */}
        {totalPages > 1 && session?.accessToken && (
          <div className="flex justify-between items-center pt-4">
            <div className="text-sm text-muted-foreground">
              Pagina {currentPage} di {totalPages} ({usersData?.total || 0}{' '}
              utenti totali)
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
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
      </SectionCard>

      {/* User Dialog */}
      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        user={selectedUser}
        onSubmit={handleFormSubmit}
        isLoading={createUserMutation.isPending || updateUserMutation.isPending}
        syncedFields={syncedFields}
        isSelfEdit={selectedUser?.id === session?.user?.id}
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
                : confirmAction.type === 'revokeSessions'
                  ? 'Revoca Sessioni Utente'
                  : 'Conferma Azione'
          }
          description={
            confirmAction.type === 'disable'
              ? "L'utente non potrà più accedere al sistema. L'operazione può essere annullata riattivando l'utente."
              : confirmAction.type === 'hardDelete'
                ? "Questa operazione è irreversibile. Tutti i dati dell'utente verranno eliminati permanentemente dal database."
                : confirmAction.type === 'revokeSessions'
                  ? "L'utente verrà disconnesso da tutti i dispositivi e dovrà effettuare nuovamente il login. Questa operazione è utile per motivi di sicurezza."
                  : 'Sei sicuro di voler procedere con questa azione?'
          }
          confirmText={
            confirmAction.type === 'disable'
              ? 'Disattiva'
              : confirmAction.type === 'hardDelete'
                ? 'Elimina Definitivamente'
                : confirmAction.type === 'revokeSessions'
                  ? 'Revoca Sessioni'
                  : 'Conferma'
          }
          cancelText="Annulla"
          variant="destructive"
          onConfirm={handleConfirmAction}
          isLoading={
            deleteUserMutation.isPending ||
            hardDeleteUserMutation.isPending ||
            revokeUserSessionsMutation.isPending
          }
          userEmail={confirmAction.user?.email}
          actionType={confirmAction.type}
        />
      )}
    </div>
  );
}
