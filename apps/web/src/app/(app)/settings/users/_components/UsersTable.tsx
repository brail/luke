'use client';

import React from 'react';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { Skeleton } from '../../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip';

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
  sortBy,
  sortOrder,
  onSort,
  onEdit,
  onDisable,
  onHardDelete,
  onRevokeSessions,
  onManageAccess,
}: UsersTableProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
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
              <TableCell>
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            user.isOnline ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {user.isOnline ? 'Online' : 'Offline'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {user.email}
                </div>
              </TableCell>
              <TableCell>{user.username}</TableCell>
              <TableCell>{user.firstName || '-'}</TableCell>
              <TableCell>{user.lastName || '-'}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {user.identities?.[0]?.provider || 'LOCAL'}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                {user.emailVerifiedAt ? (
                  <span className="text-green-600 font-bold">✓</span>
                ) : (
                  <span className="text-muted-foreground">✗</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{user.role}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={user.isActive ? 'default' : 'secondary'}>
                  {user.isActive ? 'Attivo' : 'Disattivo'}
                </Badge>
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
                    onManageAccess,
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
