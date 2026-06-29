import React from 'react';

import { cn } from '../../lib/utils';

interface KeyValueGridProps {
  cols?: 2 | 3;
  children: React.ReactNode;
  className?: string;
}

/**
 * Responsive grid layout for settings form field pairs.
 *
 * @param cols - Number of columns on desktop: `2` (default) or `3`.
 */
export function KeyValueGrid({
  cols = 2,
  children,
  className,
}: KeyValueGridProps) {
  return (
    <div
      className={cn(
        'grid gap-4',
        cols === 2 && 'grid-cols-1 md:grid-cols-2',
        cols === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        className
      )}
    >
      {children}
    </div>
  );
}
