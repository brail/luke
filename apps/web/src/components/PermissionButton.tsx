'use client';

import React from 'react';

import { cn } from '../lib/utils';

import { Button, type ButtonProps } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';

interface PermissionButtonProps extends ButtonProps {
  hasPermission: boolean;
  tooltip: string;
  infoTooltip?: string;
}

/**
 * The tooltip trigger is the `<span>`, not the button. A `<button disabled>` emits neither
 * `pointerenter` nor `focus` — and the `Button` variant adds `disabled:pointer-events-none` —
 * so with `asChild` on the button Radix never receives the event that opens the tooltip: the
 * button looked greyed out and the message explaining the block appeared to nobody. The events
 * pass through the button and the span collects them; `tabIndex` makes it reachable by keyboard,
 * where a disabled button never lands.
 *
 * `tabIndex` is 0 only while the button is disabled: an enabled button is already its own tab
 * stop, and a permanent one on the span would double it.
 */
function TooltipWrapped({
  message,
  focusable,
  children,
}: {
  message: string;
  focusable: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* `inline-flex` keeps the span neutral for the caller's layout, which expects a
            button and not an inline element with a line-height of its own. */}
        <span className="inline-flex" tabIndex={focusable ? 0 : -1}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Button with a permission gate, in three states.
 *
 * 1. **No permission** — disabled, `opacity-50 cursor-not-allowed` (the style CLAUDE.md
 *    prescribes), `tooltip` explaining the block.
 * 2. **Permission, `infoTooltip` given** — normal button carrying its own label, and that label
 *    stays reachable while `disabled` is true (a pending mutation, a boundary reached). This is
 *    the state icon-only buttons need: without it the only thing naming the action disappears
 *    exactly when the user wonders why the button does not respond.
 * 3. **Permission, no `infoTooltip`** — a bare `Button`, nothing wrapped.
 *
 * State 2 is opt-in because a wrapper the caller did not ask for is a tab stop the caller did not
 * ask for. A button with a visible label has nothing to explain and stays in state 3.
 *
 * @param hasPermission - Boolean prop from `usePermission` — do NOT call as a function.
 * @param tooltip - Message shown when `hasPermission` is false.
 * @param infoTooltip - Label shown when the permission is there; names the action for an
 *   icon-only button. Omit it for a button whose text already says what it does.
 */
export function PermissionButton({
  hasPermission,
  tooltip,
  infoTooltip,
  children,
  className,
  disabled,
  ...props
}: PermissionButtonProps) {
  if (!hasPermission) {
    return (
      <TooltipWrapped message={tooltip} focusable>
        <Button {...props} className={cn('opacity-50 cursor-not-allowed', className)} disabled>
          {children}
        </Button>
      </TooltipWrapped>
    );
  }

  const button = (
    <Button {...props} className={className} disabled={disabled}>
      {children}
    </Button>
  );

  if (!infoTooltip) {
    return button;
  }
  return (
    <TooltipWrapped message={infoTooltip} focusable={!!disabled}>
      {button}
    </TooltipWrapped>
  );
}
