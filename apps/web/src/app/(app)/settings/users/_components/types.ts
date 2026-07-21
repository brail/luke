import { sectionEnum } from '@luke/core';
import type { Role, Section } from '@luke/core';

/**
 * Shape of a single user row returned by `trpc.users.list`.
 */
export interface UserListItem {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  isActive: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  identities: Array<{
    id: string;
    provider: 'LOCAL' | 'LDAP' | 'OIDC';
    providerId: string;
  }>;
  isOnline: boolean;
}

/**
 * Keys of user table columns that support server-side sorting.
 */
export type SortColumn =
  | 'email'
  | 'username'
  | 'firstName'
  | 'lastName'
  | 'role'
  | 'isActive'
  | 'emailVerifiedAt'
  | 'createdAt'
  | 'provider';

/** Sort direction. */
export type SortOrder = 'asc' | 'desc';

/** Identifiers for the actions available in the per-user dropdown menu. */
export type UserAction = 'edit' | 'disable' | 'revokeSessions' | 'hardDelete';

/**
 * Callbacks for each user action emitted by `UserActionsMenu`.
 */
export interface UserActionHandlers {
  onEdit: (user: UserListItem) => void;
  onDisable: (user: UserListItem) => void;
  onHardDelete: (user: UserListItem) => void;
  onRevokeSessions: (user: UserListItem) => void;
  onManageAccess: (user: UserListItem) => void;
}

/**
 * Callback for triggering a sort change on a table column.
 */
export interface SortHandlers {
  onSort: (column: SortColumn) => void;
}

/**
 * Event callbacks exposed by `UsersToolbar` to the parent page.
 */
export interface ToolbarHandlers {
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: string) => void;
  onCreateUser: () => void;
  onPageChange: (page: number) => void;
}

/**
 * Current sort state shared between the toolbar and the table.
 */
export interface SortState {
  sortBy: SortColumn;
  sortOrder: SortOrder;
}

/**
 * Read-only state props consumed by `UsersToolbar`.
 */
export interface ToolbarProps {
  searchTerm: string;
  roleFilter: string;
  currentPage: number;
  totalPages: number;
  totalUsers: number;
}

/**
 * Read-only state props consumed by `UsersTable`.
 */
export interface TableProps {
  users: UserListItem[];
  currentUserId: string;
  isLoading?: boolean;
  error?: any;
}

/**
 * Per-section visibility overrides for a user.
 * A missing key means the role default applies; `true`/`false` is an explicit override.
 */
export type SectionOverrideMap = Partial<Record<string, boolean>>;

/**
 * Brand-scoped season access map.
 * `null` value means all seasons are allowed for that brand; a string array is an explicit allowlist.
 */
export type SeasonAccessMap = Record<string, string[] | null>;

/** Minimal user shape required by `ApproveUserDialog`. */
export type UserForApproval = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
};

/** Human-readable display labels for every application section, used in access-management UIs. */
export const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  settings: 'Impostazioni',
  'settings.users': '↳ Utenti',
  'settings.storage': '↳ Storage',
  'settings.mail': '↳ Mail',
  'settings.ldap': '↳ Auth LDAP',
  'settings.nav': '↳ Microsoft NAV',
  'settings.nav_sync': '↳ Sincronizzazione NAV',
  'settings.google': '↳ Google Workspace',
  'settings.collection_control': '↳ Alert Calendario/Fasi',
  maintenance: 'Manutenzione',
  'maintenance.config': '↳ Configurazioni',
  'maintenance.import_export': '↳ Import/Export',
  product: 'Prodotto',
  'product.pricing': '↳ Pricing',
  'product.collection_layout': '↳ Collection Layout',
  'product.merchandising_plan': '↳ Merchandising Plan',
  'product.controllo': '↳ Controllo Collezione',
  admin: 'Amministrazione',
  'admin.brands': '↳ Brand',
  'admin.seasons': '↳ Stagioni',
  'admin.vendors': '↳ Fornitori',
  'admin.collection_layout_configuration': '↳ Configurazione Collection Layout',
  'admin.calendar_configuration': '↳ Configurazione Calendario',
  'admin.phase_catalog': '↳ Catalogo Fasi',
  sales: 'Vendite',
  'sales.statistics': '↳ Statistiche',
  planning: 'Pianificazione',
  'settings.company': '↳ Azienda',
};

/** All valid section keys derived directly from `sectionEnum` — never duplicate manually. */
export const ALL_SECTIONS: readonly Section[] = sectionEnum.options;
