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
 * Standardized creation button that is always visible but disabled when the user lacks permission.
 *
 * Wraps `PermissionButton` and shows a tooltip when `canCreate` is false.
 *
 * @param canCreate - Boolean prop from `usePermission` — do NOT call as a function.
 * @param resourceName - Human-readable resource name used in the permission tooltip.
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
