import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionSlot?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  actionSlot,
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-10">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <h2 className="text-lg font-medium">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground max-w-prose">
          {description}
        </p>
      )}
      {actionSlot}
    </div>
  );
}
