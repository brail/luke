'use client';

import React from 'react';

import { cn } from '../lib/utils';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';

interface PermissionTooltipProps {
  hasPermission: boolean;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Explanatory tooltip for a control disabled by a missing permission, when that control is not a
 * `Button` — a native `<button>`, a `Checkbox`, a whole group of controls. For a `Button`, use
 * `PermissionButton` instead: it also applies the `opacity-50 cursor-not-allowed` styling this
 * component leaves to the caller.
 *
 * Renders `children` untouched when the permission is there, so the tooltip and the extra tab stop
 * only exist in the state they explain.
 *
 * The trigger is the `<span>`, never the disabled control itself: a disabled element emits neither
 * `pointerenter` nor `focus` and is skipped by `Tab`, so a tooltip attached to it can be reached
 * by nobody. `tabIndex={0}` puts the span in the tab order in its place — see `PermissionButton`,
 * which solved the same problem first.
 *
 * Wrapping a group in one instance is deliberate where the controls share a single reason: one tab
 * stop and one message beat the same sentence repeated on every control.
 *
 * The wrapped control must carry `disabled:pointer-events-none`. A disabled form control dispatches
 * no pointer events at all, and the browser does not hand them to the parent either, so without it
 * the span never sees the hover and the tooltip is keyboard-only — the same defect in a new place.
 * `PermissionButton` gets this for free: `buttonVariants` already carries the class.
 *
 * @param hasPermission - Boolean prop from `usePermission` — do NOT call as a function.
 * @param tooltip - Message shown when `hasPermission` is false.
 * @param className - Extra classes for the wrapper span, which is `inline-flex` by default. It
 *   applies only in the denied branch — the permitted branch has no span — so use it to neutralise
 *   the wrapper (`w-full` around a block child), never to style the children themselves.
 */
export function PermissionTooltip({
  hasPermission,
  tooltip,
  children,
  className,
}: PermissionTooltipProps) {
  if (hasPermission) {
    return <>{children}</>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', className)} tabIndex={0}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
