'use client';

import React from 'react';

import { Button } from '../../../../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';

import { SortableHeader } from './SortableHeader';
import {
  SortColumn,
  SortOrder,
  UserActionHandlers,
  SortHandlers,
  TableProps,
} from './types';
import { UserActionsMenu } from './UserActionsMenu';

interface UsersTableProps extends TableProps, SortHandlers, UserActionHandlers {
  sortBy: SortColumn;
  sortOrder: SortOrder;
}

/**
 * Tabella utenti con header ordinabili e menu azioni
 * Gestisce rendering righe, stati vuoti e azioni utente
 */
export function UsersTable({
  users,
  currentUserId,
  isLoading = false,
  error = null,
  refetch,
  sortBy,
  sortOrder,
  onSort,
  onEdit,
  onDisable,
  onHardDelete,
  onRevokeSessions,
}: UsersTableProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p>Caricamento utenti...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-destructive mb-2">
          Errore nel caricamento utenti
        </div>
        <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Riprova
        </Button>
      </div>
    );
  }

  // Empty state
  if (users.length === 0) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader
                column="email"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Email
              </SortableHeader>
              <SortableHeader
                column="username"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Username
              </SortableHeader>
              <SortableHeader
                column="firstName"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Nome
              </SortableHeader>
              <SortableHeader
                column="lastName"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Cognome
              </SortableHeader>
              <SortableHeader
                column="provider"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Provider
              </SortableHeader>
              <SortableHeader
                column="emailVerifiedAt"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Email
              </SortableHeader>
              <SortableHeader
                column="role"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Ruolo
              </SortableHeader>
              <SortableHeader
                column="isActive"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Stato
              </SortableHeader>
              <SortableHeader
                column="createdAt"
                currentSort={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              >
                Creato
              </SortableHeader>
              <TableHead>Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell
                colSpan={9}
                className="text-center py-8 text-muted-foreground"
              >
                Nessun utente trovato
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader
              column="email"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Email
            </SortableHeader>
            <SortableHeader
              column="username"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Username
            </SortableHeader>
            <SortableHeader
              column="firstName"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Nome
            </SortableHeader>
            <SortableHeader
              column="lastName"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Cognome
            </SortableHeader>
            <SortableHeader
              column="provider"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Provider
            </SortableHeader>
            <SortableHeader
              column="emailVerifiedAt"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Email
            </SortableHeader>
            <SortableHeader
              column="role"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Ruolo
            </SortableHeader>
            <SortableHeader
              column="isActive"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Stato
            </SortableHeader>
            <SortableHeader
              column="createdAt"
              currentSort={sortBy}
              sortOrder={sortOrder}
              onSort={onSort}
            >
              Creato
            </SortableHeader>
            <TableHead>Azioni</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map(user => (
            <TableRow key={user.id}>
              <TableCell>{user.email}</TableCell>
              <TableCell>{user.username}</TableCell>
              <TableCell>{user.firstName || '-'}</TableCell>
              <TableCell>{user.lastName || '-'}</TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium">
                  {user.identities?.[0]?.provider || 'LOCAL'}
                </span>
              </TableCell>
              <TableCell className="text-center">
                {user.emailVerifiedAt ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-muted-foreground">✗</span>
                )}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full bg-secondary px-2 py-1 text-xs font-medium">
                  {user.role}
                </span>
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                    user.isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {user.isActive ? 'Attivo' : 'Disattivo'}
                </span>
              </TableCell>
              <TableCell>
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString('it-IT')
                  : 'N/A'}
              </TableCell>
              <TableCell>
                <UserActionsMenu
                  user={user}
                  currentUserId={currentUserId}
                  handlers={{
                    onEdit,
                    onDisable,
                    onHardDelete,
                    onRevokeSessions,
                  }}
                  refetch={refetch}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
