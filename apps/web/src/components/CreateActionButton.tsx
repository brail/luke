'use client';

import { PermissionButton } from './PermissionButton';

interface CreateActionButtonProps {
  label: string;
  onClick: () => void;
  canCreate: boolean;
  resourceName: string;
  isLoading?: boolean;
}

/**
 * Bottone di creazione uniforme con tooltip quando disabilitato.
 * Mostra sempre il bottone, disabilitato se l'utente non ha permessi.
 */
export function CreateActionButton({
  label,
  onClick,
  canCreate,
  resourceName,
  isLoading = false,
}: CreateActionButtonProps) {
  return (
    <PermissionButton
      hasPermission={canCreate}
      tooltip={`Non hai i permessi per creare ${resourceName}`}
      onClick={onClick}
      disabled={isLoading}
    >
      {label}
    </PermissionButton>
  );
}
