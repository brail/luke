'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { UserForm } from './UserForm';

interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  identities?: Array<{
    provider: 'LOCAL' | 'LDAP' | 'OIDC';
    providerId: string;
  }>;
}

export interface UserDialogSubmitData {
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  confirmPassword?: string;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
}

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  user?: User;
  onSubmit: (userData: UserDialogSubmitData) => void;
  isLoading?: boolean;
  syncedFields?: (
    | 'email'
    | 'username'
    | 'firstName'
    | 'lastName'
    | 'role'
    | 'password'
  )[];
  isSelfEdit?: boolean;
  /** Whether the current user may reset another user's password (requires `*:*`). Defaults to `true` for callers that don't gate this (e.g. self-service create flows outside admin settings). */
  canResetPassword?: boolean;
}

/**
 * Modal dialog for creating or editing a user, wrapping `UserForm`.
 *
 * @param mode - `create` shows a blank form; `edit` pre-populates fields from `user`.
 * @param syncedFields - Fields managed externally (e.g. LDAP) are rendered as read-only.
 * @param isSelfEdit - When true, prevents the user from changing their own role or disabling their own account.
 * @param canResetPassword - When false, disables the password field in edit mode with an explanatory note.
 */
export function UserDialog({
  open,
  onOpenChange,
  mode,
  user,
  onSubmit,
  isLoading = false,
  syncedFields,
  isSelfEdit = false,
  canResetPassword = true,
}: UserDialogProps) {
  void open; // Usa il parametro open per evitare warning

  const handleSubmit = (userData: {
    email: string;
    username: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    confirmPassword?: string;
    role: 'admin' | 'editor' | 'viewer';
    isActive: boolean;
  }) => {
    onSubmit(userData);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] p-0 gap-0 flex flex-col"> {/* px/vh: dialog width tuned to content, vh cap has no Tailwind scale equivalent */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle>
            {mode === 'create' ? 'Nuovo Utente' : 'Modifica Utente'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Crea un nuovo utente nel sistema. Tutti i campi sono obbligatori.'
              : "Modifica i dati dell'utente. Lascia la password vuota per non modificarla."}
          </DialogDescription>
        </DialogHeader>

        <UserForm
          mode={mode}
          initialData={{
            ...user,
            provider: user?.identities?.[0]?.provider,
          }}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isLoading={isLoading}
          syncedFields={syncedFields}
          isSelfEdit={isSelfEdit}
          canResetPassword={canResetPassword}
        />
      </DialogContent>
    </Dialog>
  );
}
