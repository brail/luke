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
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface UserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  user?: User;
  onSubmit: (userData: {
    email: string;
    username: string;
    password?: string;
    confirmPassword?: string;
    role: 'admin' | 'editor' | 'viewer';
    isActive: boolean;
  }) => void;
  isLoading?: boolean;
}

/**
 * Dialog modal per creazione e modifica utenti
 * Wrapper del UserForm con gestione modal
 */
// eslint-disable-next-line no-unused-vars
export function UserDialog({
  open,
  onOpenChange,
  mode,
  user,
  onSubmit,
  isLoading = false,
}: UserDialogProps) {
  const handleSubmit = (userData: {
    email: string;
    username: string;
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
      <DialogContent className="sm:max-w-[425px]">
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
          initialData={user}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  );
}
