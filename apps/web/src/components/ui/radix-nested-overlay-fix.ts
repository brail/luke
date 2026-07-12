import type * as DialogPrimitive from '@radix-ui/react-dialog';
import type * as React from 'react';

type InteractOutsideHandler = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>['onInteractOutside'];

/**
 * Guards a modal Dialog/Sheet against closing itself when interaction happens inside a nested
 * Radix overlay (a Select/Popover dropdown, or a stacked Dialog/Sheet/AlertDialog like a
 * ConfirmDialog). Two Radix races produce a false "outside click":
 *
 * 1. Pointer-events race: a nested overlay is always modal and becomes the topmost dismissable
 *    layer, zeroing this Content's own pointer-events while open. Closing it lets the closing
 *    click fall through to the Overlay behind this Content, reading as "outside".
 * 2. Layer-stack staleness race: closing a nested modal unregisters it from Radix's dismissable
 *    layer stack synchronously, mid-click — before the same click finishes bubbling to
 *    `document`. This Content's "am I topmost" check flips true in the same tick, so the
 *    still-bubbling click (target lives in the nested modal's portal, a DOM sibling) reads as
 *    an outside click here too.
 *
 * `pointerEvents: auto` fixes #1; the onInteractOutside guard (matching nested popper content or
 * `role="dialog"`/`"alertdialog"`) fixes both. Shared by DialogContent/SheetContent (same Radix
 * base). Not needed by AlertDialogContent — Radix hardcodes its onInteractOutside to
 * preventDefault() unconditionally.
 */
export function withNestedOverlayFix(style: React.CSSProperties | undefined, onInteractOutside: InteractOutsideHandler) {
  return {
    style: { pointerEvents: 'auto' as const, ...style },
    onInteractOutside: ((event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]')) {
        event.preventDefault();
      }
      onInteractOutside?.(event);
    }) as InteractOutsideHandler,
  };
}
