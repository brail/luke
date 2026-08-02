'use client';

import React from 'react';

import { cn } from '../lib/utils';

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
 * Il trigger del tooltip è lo `<span>`, non il bottone. Un `<button disabled>` non emette
 * `pointerenter` né `focus` — e la variante `Button` aggiunge `disabled:pointer-events-none` —
 * quindi con `asChild` sul bottone Radix non riceve mai l'evento che apre il tooltip: il bottone
 * appariva grigio e il messaggio che spiega il blocco non compariva a nessuno. Gli eventi passano
 * attraverso il bottone e li raccoglie lo span; `tabIndex={0}` lo rende raggiungibile da tastiera,
 * dove un bottone disabilitato non arriva.
 *
 * `opacity-50 cursor-not-allowed` è lo stile che CLAUDE.md prescrive per lo stato senza permesso.
 *
 * @param hasPermission - Boolean prop from `usePermission` — do NOT call as a function.
 * @param tooltip - Message shown in the tooltip when the button is disabled.
 */
export function PermissionButton({
  hasPermission,
  tooltip,
  children,
  className,
  ...props
}: PermissionButtonProps) {
  if (!hasPermission) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* `inline-flex` tiene lo span neutro rispetto al layout del chiamante, che si aspetta
                un bottone e non un elemento inline con line-height propria. */}
            <span className="inline-flex" tabIndex={0}>
              <Button {...props} className={cn('opacity-50 cursor-not-allowed', className)} disabled>
                {children}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <Button {...props} className={className}>{children}</Button>;
}
