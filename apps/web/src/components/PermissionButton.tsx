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
 * Button with a permission gate: renders as a normal `Button` when allowed, or as a
 * disabled button with an explanatory tooltip when `hasPermission` is false.
 *
 * @param hasPermission - Boolean prop from `usePermission` — do NOT call as a function.
 * @param tooltip - Message shown in the tooltip when the button is disabled.
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
