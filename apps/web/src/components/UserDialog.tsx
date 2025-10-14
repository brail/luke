/* eslint-disable no-unused-vars */
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
  firstName?: string;
  lastName?: string;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  identities?: Array<{
    provider: 'LOCAL' | 'LDAP' | 'OIDC';
    providerId: string;
  }>;
}

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  user?: User;
  onSubmit: (userData: {
    email: string;
    username: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    confirmPassword?: string;
    role: 'admin' | 'editor' | 'viewer';
    isActive: boolean;
  }) => void;
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
}

/**
 * Dialog modal per creazione e modifica utenti
 * Wrapper del UserForm con gestione modal
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
}: UserDialogProps) {
  // eslint-disable-next-line no-unused-vars
  const _ = open; // Usa il parametro open per evitare warning

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
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
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
        />
      </DialogContent>
    </Dialog>
  );
}
