import { sectionEnum } from '@luke/core';
import type { Role, Section } from '@luke/core';

// Tipo per riga utente nella tabella (derivato da trpc.users.list response)
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

// Colonne ordinabili della tabella
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
  onManageAccess: (user: UserListItem) => void;
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

// Tipi per gestione accesso sezioni/brand/stagioni
// null = usa default ruolo, true/false = override esplicito
export type SectionOverrideMap = Partial<Record<string, boolean>>;
// null = tutte le stagioni consentite per quel brand, string[] = whitelist
export type SeasonAccessMap = Record<string, string[] | null>;

export type UserForApproval = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
};

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
  maintenance: 'Manutenzione',
  'maintenance.config': '↳ Configurazioni',
  'maintenance.import_export': '↳ Import/Export',
  product: 'Prodotto',
  'product.pricing': '↳ Pricing',
  'product.collection_layout': '↳ Collection Layout',
  'product.merchandising_plan': '↳ Merchandising Plan',
  admin: 'Amministrazione',
  'admin.brands': '↳ Brand',
  'admin.seasons': '↳ Stagioni',
  'admin.vendors': '↳ Fornitori',
  'admin.collection_catalog': '↳ Catalogo collezioni',
  'admin.calendars': '↳ Template calendario',
  sales: 'Vendite',
  'sales.statistics': '↳ Statistiche',
  planning: 'Pianificazione',
  'planning.sales': '↳ Vendite',
  'planning.product': '↳ Prodotto',
  'planning.sourcing': '↳ Sourcing',
  'planning.merchandising': '↳ Merchandising',
};

// Deriva direttamente da sectionEnum — mai duplicare manualmente
export const ALL_SECTIONS: readonly Section[] = sectionEnum.options;
