'use client';

import React from 'react';

import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';

import { ToolbarProps, ToolbarHandlers } from './types';

interface UsersToolbarProps extends ToolbarProps, ToolbarHandlers {}

/**
 * Toolbar per ricerca, filtri e paginazione utenti
 * Include search input, role filter, azioni e paginazione
 */
export function UsersToolbar({
  searchTerm,
  roleFilter,
  currentPage,
  totalPages,
  totalUsers,
  onSearchChange,
  onRoleFilterChange,
  onCreateUser,
  onPageChange,
}: UsersToolbarProps) {
  return (
    <div className="space-y-4">
      {/* Search e Filtri */}
      <div className="flex gap-4 items-center">
        <div className="flex-1">
          <Input
            placeholder="Cerca per email o username..."
            value={searchTerm}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        <div>
          <select
            value={roleFilter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              onRoleFilterChange(e.target.value)
            }
            className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Tutti i ruoli</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      </div>

      {/* Azioni */}
      <div className="flex gap-2">
        <Button onClick={onCreateUser}>Nuovo Utente</Button>
      </div>

      {/* Paginazione */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center pt-4">
          <div className="text-sm text-muted-foreground">
            Pagina {currentPage} di {totalPages} ({totalUsers} utenti totali)
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              Precedente
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onPageChange(Math.min(totalPages, currentPage + 1))
              }
              disabled={currentPage === totalPages}
            >
              Successiva
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
