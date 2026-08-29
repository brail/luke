'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { toast } from 'sonner';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionCard } from '../../../../components/SectionCard';
import { ErrorBoundary } from '../../../../components/system/ErrorBoundary';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../../components/ui/tabs';
import { UserDialog, type UserDialogSubmitData } from '../../../../components/UserDialog';
import { usePermission } from '../../../../hooks/usePermission';
import { debugLog } from '../../../../lib/debug';
import { useRefresh } from '../../../../lib/refresh';
import { trpc } from '../../../../lib/trpc';
import { useStandardMutation } from '../../../../lib/useStandardMutation';

import { ApproveUserDialog } from './_components/ApproveUserDialog';
import { PendingUsersTab } from './_components/PendingUsersTab';
import { SendVerificationDialog } from './_components/SendVerificationDialog';
import { SortColumn, SortOrder, type UserForApproval, type UserListItem } from './_components/types';
import { UserAccessDialog } from './_components/UserAccessDialog';
import { UsersTable } from './_components/UsersTable';
import { UsersToolbar } from './_components/UsersToolbar';

/** Identifiers for the actions the confirm dialog can be opened for. */
type ConfirmActionType =
  | 'disable'
  | 'hardDelete'
  | 'revokeSessions'
  | 'forceLocalAccess'
  | 'revokeLocalAccess';

/** Copy + dialog styling for each `ConfirmActionType`, keyed by type so adding one is a single new entry. */
const CONFIRM_ACTION_CONFIG: Record<
  ConfirmActionType,
  {
    title: string;
    description: string;
    confirmText: string;
    actionType: 'disable' | 'hardDelete' | 'revokeSessions' | 'warning';
    /** Set only where the action is irreversible and has to be typed out to unlock. */
    confirmPhrase?: string;
  }
> = {
  disable: {
    title: 'Disattiva Utente',
    description:
      "L'utente non potrà più accedere al sistema. L'operazione può essere annullata riattivando l'utente.",
    confirmText: 'Disattiva',
    actionType: 'disable',
  },
  hardDelete: {
    title: 'Elimina Definitivamente',
    description:
      "Questa operazione è irreversibile. Tutti i dati dell'utente verranno eliminati permanentemente dal database.",
    confirmText: 'Elimina Definitivamente',
    actionType: 'hardDelete',
    confirmPhrase: HARD_DELETE_CONFIRM_PHRASE,
  },
  revokeSessions: {
    title: 'Revoca Sessioni Utente',
    description:
      "L'utente verrà disconnesso da tutti i dispositivi e dovrà effettuare nuovamente il login. Questa operazione è utile per motivi di sicurezza.",
    confirmText: 'Revoca Sessioni',
    actionType: 'revokeSessions',
  },
  forceLocalAccess: {
    title: 'Forza Accesso Locale',
    description:
      "Verrà creata una credenziale locale per questo utente e inviato un link per impostare la password, bypassando il controllo Active Directory/LDAP esistente. L'identity esterna non viene rimossa: se AD riattiva l'account, tornerà a funzionare anche quello.",
    confirmText: 'Forza Accesso Locale',
    actionType: 'warning',
  },
  revokeLocalAccess: {
    title: 'Revoca Accesso Locale',
    description:
      "La credenziale locale verrà rimossa: l'utente potrà accedere solo tramite LDAP/OIDC. Tutte le sessioni attive verranno terminate.",
    confirmText: 'Revoca Accesso Locale',
    actionType: 'warning',
  },
};

/**
 * Pagina gestione utenti con CRUD completo
 * Include lista paginata, filtri, creazione, modifica e eliminazione utenti
 * Layout e header gestiti dal layout padre
 */
export default function UsersPage() {
  const { data: session } = useSession();
  const { can } = usePermission();

  // Stato per dialog e paginazione
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedUser, setSelectedUser] = useState<UserListItem | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [syncedFields, setSyncedFields] = useState<
    ('email' | 'username' | 'firstName' | 'lastName' | 'role' | 'password')[]
  >([]);

  // Stato per modal di conferma
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: ConfirmActionType;
    user: UserListItem;
    /** Receives the typed phrase for the actions that are gated behind one. */
    handler: (confirmPhrase?: string) => void;
  } | null>(null);

  // Stato per ordinamento
  const [sortBy, setSortBy] = useState<SortColumn>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Stato per dialog invio email verifica post-creazione
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);

  const [pendingAccessUser, setPendingAccessUser] =
    useState<UserForApproval | null>(null);

  // Stato per dialog gestione accesso
  const [accessDialogUser, setAccessDialogUser] = useState<UserListItem | null>(null);

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
      enabled: !!session?.accessToken,
      refetchInterval: 60_000, // Allineato all'intervallo heartbeat
    }
  );

  // Mutation tRPC
  const createUserMutation = trpc.users.create.useMutation();
  const updateUserMutation = trpc.users.update.useMutation();
  const deleteUserMutation = trpc.users.softDelete.useMutation();
  const hardDeleteUserMutation = trpc.users.hardDelete.useMutation();
  const revokeUserSessionsMutation =
    trpc.users.revokeUserSessions.useMutation();
  const forceLocalAccessMutation = trpc.users.forceLocalAccess.useMutation();
  const revokeLocalAccessMutation = trpc.users.revokeLocalAccess.useMutation();

  // Mutations standardizzate
  const { mutate: createUser, isPending: isCreatingUser } = useStandardMutation(
    {
      mutateFn: createUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente creato con successo',
      onErrorMessage: 'Errore nella creazione',
      onSuccess: data => {
        setDialogOpen(false);
        setPendingAccessUser({
          id: data.id,
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
        });
      },
    }
  );

  const { mutate: updateUser, isPending: isUpdatingUser } = useStandardMutation(
    {
      mutateFn: updateUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente aggiornato con successo',
      onErrorMessage: "Errore nell'aggiornamento",
      entityMessages: { FORBIDDEN: true },
      onSuccess: () => setDialogOpen(false),
    }
  );

  const { mutate: deleteUser, isPending: isDeletingUser } = useStandardMutation(
    {
      mutateFn: deleteUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente disattivato con successo',
      onErrorMessage: 'Errore nella disattivazione',
      entityMessages: { FORBIDDEN: true },
    }
  );

  const { mutate: hardDeleteUser, isPending: isHardDeletingUser } =
    useStandardMutation({
      mutateFn: hardDeleteUserMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccessMessage: 'Utente eliminato definitivamente',
      onErrorMessage: "Errore nell'eliminazione",
      entityMessages: { FORBIDDEN: true },
    });

  const { mutate: revokeUserSessions, isPending: isRevokingSessions } =
    useStandardMutation({
      mutateFn: revokeUserSessionsMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccess: data => toast.success(data.message),
      onErrorMessage: 'Errore nella revoca sessioni',
    });

  const { mutate: forceLocalAccess, isPending: isForcingLocalAccess } =
    useStandardMutation({
      mutateFn: forceLocalAccessMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccess: data => toast.success(data.message),
      onErrorMessage: "Errore nel forzare l'accesso locale",
      entityMessages: { FORBIDDEN: true },
    });

  const { mutate: revokeLocalAccess, isPending: isRevokingLocalAccess } =
    useStandardMutation({
      mutateFn: revokeLocalAccessMutation.mutateAsync,
      invalidate: refresh.users,
      onSuccess: data => toast.success(data.message),
      onErrorMessage: "Errore nel revocare l'accesso locale",
      entityMessages: { FORBIDDEN: true },
    });

  // Handlers per le azioni

  const handleCreateUser = () => {
    setDialogMode('create');
    setSelectedUser(null);
    setSyncedFields([]); // Nuovo utente = nessun campo sincronizzato
    setDialogOpen(true);
  };

  const handleEditUser = (user: UserListItem) => {
    setDialogMode('edit');
    setSelectedUser(user);
    // Determina campi sincronizzati in base al provider
    // Per provider esterni (LDAP, OIDC): blocca username, firstName, lastName e password
    // email and role are editable even for external users
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

  const handleDeleteUser = (user: UserListItem) => {
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

  const handleHardDeleteUser = (user: UserListItem) => {
    setConfirmAction({
      type: 'hardDelete',
      user,
      handler: phrase => {
        if (phrase) hardDeleteUser({ id: user.id, confirmPhrase: phrase });
      },
    });
    setConfirmDialogOpen(true);
  };

  const handleConfirmAction = (confirmPhrase?: string) => {
    if (confirmAction) {
      confirmAction.handler(confirmPhrase);
    }
  };

  const handleRevokeUserSessions = (user: UserListItem) => {
    // Protezione: impedisci auto-revoca
    if (user.id === session?.user?.id) {
      toast.error(
        'Non puoi revocare le tue stesse sessioni da qui. Usa il profilo personale.'
      );
      return;
    }

    // Confirm before proceeding
    setConfirmAction({
      type: 'revokeSessions',
      user,
      handler: () => revokeUserSessions({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleForceLocalAccess = (user: UserListItem) => {
    setConfirmAction({
      type: 'forceLocalAccess',
      user,
      handler: () => forceLocalAccess({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleRevokeLocalAccess = (user: UserListItem) => {
    // Same self-lockout guard as handleRevokeUserSessions (revoke bumps
    // tokenVersion, would end the admin's own session mid-action).
    if (user.id === session?.user?.id) {
      toast.error('Non puoi revocare il tuo stesso accesso locale.');
      return;
    }

    setConfirmAction({
      type: 'revokeLocalAccess',
      user,
      handler: () => revokeLocalAccess({ id: user.id }),
    });
    setConfirmDialogOpen(true);
  };

  const handleSort = (column: SortColumn) => {
    if (sortBy === column) {
      // If same column, toggle sort order
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // If new column, set as ascending
      setSortBy(column);
      setSortOrder('asc');
    }
    // Reset to first page when changing sort
    setCurrentPage(1);
  };

  const handleFormSubmit = (data: UserDialogSubmitData) => {
    if (dialogMode === 'create') {
      // CreateUserSchema (UserForm) requires password (min 12 chars) in create mode; the shared
      // UserDialogSubmitData type just doesn't encode that per-mode distinction.
      createUser({ ...data, password: data.password ?? '' });
    } else {
      if (!selectedUser) return;
      // Filtra i campi per self-edit
      const isSelfEdit = selectedUser.id === session?.user?.id;
      const updateData: Parameters<typeof updateUserMutation.mutateAsync>[0] = { id: selectedUser.id };

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

      // Reset password: only if admin actually typed a value — `UserForm`
      // already removes `password` from payload when left empty in edit mode.
      if (data.password && data.password.trim() !== '') {
        updateData.password = data.password;
      }

      // Role only if not self-edit
      if (!isSelfEdit && data.role !== selectedUser.role) {
        updateData.role = data.role;
      }

      updateUser(updateData);
    }
  };

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to first page
  };

  const handleRoleFilter = (value: string) => {
    setRoleFilter(value);
    setCurrentPage(1); // Reset to first page
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

        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Utenti attivi</TabsTrigger>
            <TabsTrigger value="pending">In attesa di approvazione</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-6 mt-4">
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
                canCreate={can('users:create')}
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
                  onManageAccess={setAccessDialogUser}
                  onForceLocalAccess={handleForceLocalAccess}
                  onRevokeLocalAccess={handleRevokeLocalAccess}
                />
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="pending" className="mt-4">
            <SectionCard
              title="Richieste di accesso in attesa"
              description="Utenti LDAP che si sono autenticati per la prima volta e attendono approvazione"
            >
              <PendingUsersTab />
            </SectionCard>
          </TabsContent>
        </Tabs>

        {/* User Dialog */}
        <UserDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mode={dialogMode}
          user={selectedUser ?? undefined}
          onSubmit={handleFormSubmit}
          isLoading={isCreatingUser || isUpdatingUser}
          syncedFields={syncedFields}
          isSelfEdit={selectedUser?.id === session?.user?.id}
          canResetPassword={can('*:*')}
        />

        {/* Confirm Dialog */}
        {confirmAction && (
          <ConfirmDialog
            open={confirmDialogOpen}
            onOpenChange={setConfirmDialogOpen}
            title={CONFIRM_ACTION_CONFIG[confirmAction.type].title}
            description={CONFIRM_ACTION_CONFIG[confirmAction.type].description}
            confirmText={CONFIRM_ACTION_CONFIG[confirmAction.type].confirmText}
            cancelText="Annulla"
            onConfirm={handleConfirmAction}
            isLoading={
              isDeletingUser ||
              isHardDeletingUser ||
              isRevokingSessions ||
              isForcingLocalAccess ||
              isRevokingLocalAccess
            }
            userEmail={confirmAction.user?.email}
            actionType={CONFIRM_ACTION_CONFIG[confirmAction.type].actionType}
            confirmPhrase={CONFIRM_ACTION_CONFIG[confirmAction.type].confirmPhrase}
          />
        )}

        {/* Dialog gestione accesso sezioni + brand/season */}
        {accessDialogUser && (
          <UserAccessDialog
            user={accessDialogUser}
            open={!!accessDialogUser}
            onOpenChange={open => { if (!open) setAccessDialogUser(null); }}
          />
        )}

        {pendingAccessUser && (
          <ApproveUserDialog
            user={pendingAccessUser}
            open
            onOpenChange={open => {
              if (!open) setPendingAccessUser(null);
            }}
            onApproved={() => {
              setCreatedUserId(pendingAccessUser.id);
              setPendingAccessUser(null);
              setShowVerifyDialog(true);
              refresh.users();
            }}
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
