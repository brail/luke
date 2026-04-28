'use client';

import { Check, X } from 'lucide-react';
import React, { useState } from 'react';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
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
import { usePermission } from '../../../../../hooks/usePermission';
import { useRefresh } from '../../../../../lib/refresh';
import { trpc } from '../../../../../lib/trpc';
import { useStandardMutation } from '../../../../../lib/useStandardMutation';

import { ApproveUserDialog } from './ApproveUserDialog';

/**
 * Tab per gestione utenti LDAP in attesa di approvazione admin.
 * L'approvazione richiede obbligatoriamente la configurazione dell'accesso.
 */
export function PendingUsersTab() {
  const { can } = usePermission();
  const refresh = useRefresh();

  const canUpdate = can('users:update');
  const canDelete = can('users:delete');

  const [approveTarget, setApproveTarget] = useState<{
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    role: 'admin' | 'editor' | 'viewer';
  } | null>(null);

  const [rejectTarget, setRejectTarget] = useState<{
    id: string;
    username: string;
    email: string;
  } | null>(null);

  const { data, isLoading, error } = trpc.users.listPending.useQuery();

  const rejectMutation = trpc.users.rejectPending.useMutation();

  const { mutate: reject, isPending: isRejecting } = useStandardMutation({
    mutateFn: rejectMutation.mutateAsync,
    invalidate: refresh.users,
    onSuccessMessage: 'Utente rifiutato ed eliminato',
    onErrorMessage: 'Errore nel rifiuto',
    onSuccess: () => setRejectTarget(null),
  });

  const handleReject = (user: { id: string; username: string; email: string }) => {
    setRejectTarget(user);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Errore nel caricamento degli utenti in attesa
      </div>
    );
  }

  const users = data?.users || [];

  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Nessun utente in attesa di approvazione
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Cognome</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Richiesta il</TableHead>
              <TableHead>Azioni</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(user => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.username}</TableCell>
                <TableCell>
                  {user.email.endsWith('@ldap.local') ? (
                    <span className="text-muted-foreground italic">
                      {user.email}{' '}
                      <span className="text-xs text-orange-600">(non fornita)</span>
                    </span>
                  ) : (
                    user.email
                  )}
                </TableCell>
                <TableCell>{user.firstName || '-'}</TableCell>
                <TableCell>{user.lastName || '-'}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {user.identities?.[0]?.provider || 'LDAP'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleDateString('it-IT')
                    : 'N/A'}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    {canUpdate && (
                      <Button
                        size="sm"
                        onClick={() =>
                          setApproveTarget({
                            id: user.id,
                            username: user.username,
                            firstName: user.firstName || '',
                            lastName: user.lastName || '',
                            role: user.role as 'admin' | 'editor' | 'viewer',
                          })
                        }
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Approva
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          handleReject({
                            id: user.id,
                            username: user.username,
                            email: user.email,
                          })
                        }
                      >
                        <X className="h-4 w-4 mr-1" />
                        Rifiuta
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {approveTarget && (
        <ApproveUserDialog
          user={approveTarget}
          open
          onOpenChange={open => {
            if (!open) setApproveTarget(null);
          }}
          onApproved={() => {
            setApproveTarget(null);
            refresh.users();
          }}
        />
      )}

      {rejectTarget && (
        <ConfirmDialog
          open
          onOpenChange={open => { if (!open) setRejectTarget(null); }}
          title="Rifiuta utente"
          description={`Vuoi rifiutare la richiesta di "${rejectTarget.username}"? L'account verrà eliminato definitivamente.`}
          confirmText="Rifiuta"
          cancelText="Annulla"
          variant="destructive"
          actionType="delete"
          onConfirm={() => reject({ id: rejectTarget.id })}
          isLoading={isRejecting}
        />
      )}
    </>
  );
}
