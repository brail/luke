'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { ErrorBoundary } from '../../../../components/system/ErrorBoundary';
import { UserDialog } from '../../../../components/UserDialog';
import { debugLog } from '../../../../lib/debug';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

import { SendVerificationDialog } from './_components/SendVerificationDialog';
import { SortColumn, SortOrder } from './_components/types';
import { UsersTable } from './_components/UsersTable';
import { UsersToolbar } from './_components/UsersToolbar';

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
  const [sortBy, setSortBy] = useState<SortColumn>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Stato per dialog invio email verifica post-creazione
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);

  const refresh = useRefresh();

  // Query tRPC per lista utenti con paginazione e filtri
  const {
    data: usersData,
    isLoading,
    error,
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

  // Mutation tRPC
  const createUserMutation = trpc.users.create.useMutation();
  const updateUserMutation = trpc.users.update.useMutation();
  const deleteUserMutation = trpc.users.delete.useMutation();
  const hardDeleteUserMutation = trpc.users.hardDelete.useMutation();
  const revokeUserSessionsMutation =
    trpc.users.revokeUserSessions.useMutation();

  // Mutations standardizzate
  const { mutate: createUser, isPending: isCreatingUser } = useStandardMutation(
    {
      mutateFn: createUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente creato con successo',
      onErrorMessage: 'Errore nella creazione',
      onSuccess: (data: any) => {
        setDialogOpen(false);
        // Mostra dialog per invio email verifica
        setCreatedUserId(data.id);
        setShowVerifyDialog(true);
      },
    }
  );

  const { mutate: updateUser, isPending: isUpdatingUser } = useStandardMutation(
    {
      mutateFn: updateUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente aggiornato con successo',
      onErrorMessage: "Errore nell'aggiornamento",
      onSuccess: () => setDialogOpen(false),
    }
  );

  const { mutate: deleteUser, isPending: isDeletingUser } = useStandardMutation(
    {
      mutateFn: deleteUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente disattivato con successo',
      onErrorMessage: 'Errore nella disattivazione',
    }
  );

  const { mutate: hardDeleteUser, isPending: isHardDeletingUser } =
    useStandardMutation({
      mutateFn: hardDeleteUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente eliminato definitivamente',
      onErrorMessage: "Errore nell'eliminazione",
    });

  const { mutate: revokeUserSessions, isPending: isRevokingSessions } =
    useStandardMutation({
      mutateFn: revokeUserSessionsMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccess: (data: any) => toast.success(data.message),
      onErrorMessage: 'Errore nella revoca sessioni',
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
      handler: () => deleteUser({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleHardDeleteUser = (user: any) => {
    setConfirmAction({
      type: 'hardDelete',
      user,
      handler: () => hardDeleteUser({ id: user.id }),
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
      handler: () => revokeUserSessions({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleSort = (column: SortColumn) => {
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

  const handleFormSubmit = (data: any) => {
    if (dialogMode === 'create') {
      createUser(data);
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

      updateUser(updateData);
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
    <ErrorBoundary>
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
          <UsersToolbar
            searchTerm={searchTerm}
            roleFilter={roleFilter}
            currentPage={currentPage}
            totalPages={totalPages}
            totalUsers={usersData?.total || 0}
            onSearchChange={handleSearch}
            onRoleFilterChange={handleRoleFilter}
            onCreateUser={handleCreateUser}
            onPageChange={setCurrentPage}
          />
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

          {session?.accessToken && (
            <UsersTable
              users={users}
              currentUserId={session?.user?.id || ''}
              isLoading={isLoading}
              error={error}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
              onEdit={handleEditUser}
              onDisable={handleDeleteUser}
              onHardDelete={handleHardDeleteUser}
              onRevokeSessions={handleRevokeUserSessions}
            />
          )}
        </SectionCard>

        {/* User Dialog */}
        <UserDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode={dialogMode}
          user={selectedUser}
          onSubmit={handleFormSubmit}
          isLoading={isCreatingUser || isUpdatingUser}
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
              isDeletingUser || isHardDeletingUser || isRevokingSessions
            }
            userEmail={confirmAction.user?.email}
            actionType={confirmAction.type}
          />
        )}

        {/* Dialog invio email verifica post-creazione */}
        <SendVerificationDialog
          userId={createdUserId}
          open={showVerifyDialog}
          onOpenChange={setShowVerifyDialog}
        />
      </div>
    </ErrorBoundary>
  );
}
