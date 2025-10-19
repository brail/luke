'use client';

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import React from 'react';

import { TableHead } from '../../../../../components/ui/table';

import { SortColumn, SortOrder } from './types';

interface SortableHeaderProps {
  column: SortColumn;
  currentSort: SortColumn;
  sortOrder: SortOrder;
  onSort: (column: SortColumn) => void;
  children: React.ReactNode;
}

/**
 * Header tabella ordinabile con icone sort
 * Mostra stato attivo/inattivo e gestisce click per ordinamento
 */
export function SortableHeader({
  column,
  currentSort,
  sortOrder,
  onSort,
  children,
}: SortableHeaderProps) {
  const isActive = currentSort === column;

  const getSortIcon = () => {
    if (!isActive) {
      return <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />;
    }
    return sortOrder === 'asc' ? (
      <ChevronUp className="h-4 w-4 text-primary" />
    ) : (
      <ChevronDown className="h-4 w-4 text-primary" />
    );
  };

  return (
    <TableHead
      className="cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-2">
        {children}
        {getSortIcon()}
      </div>
    </TableHead>
  );
}
