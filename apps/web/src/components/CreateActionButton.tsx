'use client';

import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface CreateActionButtonProps {
  label: string;
  onClick: () => void;
  canCreate: boolean;
  resourceName: string;
  isLoading?: boolean;
}

/**
 * Bottone di creazione uniforme con tooltip quando disabilitato
 * Mostra sempre il bottone, disabilitato se l'utente non ha permessi
 */
export function CreateActionButton({
  label,
  onClick,
  canCreate,
  resourceName,
  isLoading = false,
}: CreateActionButtonProps) {
  if (!canCreate) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button disabled className="opacity-50 cursor-not-allowed">
              {label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Non hai i permessi per creare {resourceName}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button onClick={onClick} disabled={isLoading}>
      {label}
    </Button>
  );
}
