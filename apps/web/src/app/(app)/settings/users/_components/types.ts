/**
 * Tipi condivisi per i componenti della pagina Users
 * Derivati dal response tRPC users.list
 */

// Tipo per riga utente nella tabella (derivato da trpc.users.list response)
export interface UserListItem {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  identities: Array<{
    id: string;
    provider: 'LOCAL' | 'LDAP' | 'OIDC';
    providerId: string;
  }>;
}

// Colonne ordinabili della tabella
export type SortColumn =
  | 'email'
  | 'username'
  | 'firstName'
  | 'lastName'
  | 'role'
  | 'isActive'
  | 'createdAt'
  | 'provider';

// Ordine di sort
export type SortOrder = 'asc' | 'desc';

// Azioni disponibili nel menu utente
export type UserAction = 'edit' | 'disable' | 'revokeSessions' | 'hardDelete';

// Props per handlers di azioni utente
export interface UserActionHandlers {
  onEdit: (user: UserListItem) => void;
  onDisable: (user: UserListItem) => void;
  onHardDelete: (user: UserListItem) => void;
  onRevokeSessions: (user: UserListItem) => void;
}

// Props per gestione sort
export interface SortHandlers {
  onSort: (column: SortColumn) => void;
}

// Props per gestione toolbar
export interface ToolbarHandlers {
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: string) => void;
  onCreateUser: () => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
}

// Stato sort corrente
export interface SortState {
  sortBy: SortColumn;
  sortOrder: SortOrder;
}

// Props per toolbar
export interface ToolbarProps {
  searchTerm: string;
  roleFilter: string;
  currentPage: number;
  totalPages: number;
  totalUsers: number;
}

// Props per tabella
export interface TableProps {
  users: UserListItem[];
  currentUserId: string;
  isLoading?: boolean;
  error?: any;
}
