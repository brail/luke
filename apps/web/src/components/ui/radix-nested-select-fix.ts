import type * as DialogPrimitive from '@radix-ui/react-dialog';
import type * as React from 'react';

type InteractOutsideHandler = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>['onInteractOutside'];

/**
 * Radix's Select is always "modal" (no way to opt out) — while its dropdown is open it becomes
 * the topmost dismissable layer and sets the parent Dialog/Sheet Content's own pointer-events to
 * "none" (only the topmost layer stays interactive). Closing the Select then races with the
 * parent's own outside-click detection: the closing click falls through the now
 * pointer-events:none Content onto its Overlay behind it, which reads as an "outside click" and
 * closes the parent too. Forcing pointer-events:auto keeps the parent always interactive
 * regardless of any nested Select's layer state; the onInteractOutside guard is an extra safety
 * net for interactions landing inside any nested Radix popper content (Select/Popover).
 *
 * Shared by `DialogContent` and `SheetContent` — both are built on `@radix-ui/react-dialog`, so
 * they hit the exact same race.
 */
export function withNestedSelectFix(style: React.CSSProperties | undefined, onInteractOutside: InteractOutsideHandler) {
  return {
    style: { pointerEvents: 'auto' as const, ...style },
    onInteractOutside: ((event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-radix-popper-content-wrapper]')) {
        event.preventDefault();
      }
      onInteractOutside?.(event);
    }) as InteractOutsideHandler,
  };
}
