import React from 'react';

interface ErrorStateProps {
  title: string;
  description?: string;
  actionSlot?: React.ReactNode;
  secondarySlot?: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * Centered error state with an optional icon, title, description, and two action slots.
 *
 * Wrapped in an ARIA live region so screen readers announce the error.
 *
 * @param actionSlot - Primary action, typically a `RetryButton`.
 * @param secondarySlot - Optional secondary action or link.
 */
export function ErrorState({
  title,
  description,
  actionSlot,
  secondarySlot,
  icon,
}: ErrorStateProps) {
  return (
    <div role="status" aria-live="polite">
      <div className="flex flex-col items-center text-center gap-4 py-6">
        {icon && <div className="text-destructive">{icon}</div>}
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground max-w-prose">
            {description}
          </p>
        )}
        {actionSlot}
        {secondarySlot}
      </div>
    </div>
  );
}
