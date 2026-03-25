'use client';

import React from 'react';

import { Button, type ButtonProps } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface PermissionButtonProps extends ButtonProps {
  hasPermission: boolean;
  tooltip: string;
}

/**
 * Bottone con gate permesso: se hasPermission=false mostra il bottone
 * disabilitato con tooltip esplicativo, altrimenti si comporta come <Button>.
 */
export function PermissionButton({
  hasPermission,
  tooltip,
  children,
  ...props
}: PermissionButtonProps) {
  if (!hasPermission) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button {...props} disabled>
              {children}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <Button {...props}>{children}</Button>;
}
