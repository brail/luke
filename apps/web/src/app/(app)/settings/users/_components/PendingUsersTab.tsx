'use client';

import { Check, X } from 'lucide-react';
import React, { useState } from 'react';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { Button } from '../../../../../components/ui/button';
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

/**
 * Tab per gestione utenti LDAP in attesa di approvazione admin.
 * Mostra la lista e permette di approvare o rifiutare ogni richiesta.
 */
export function PendingUsersTab() {
  const { can } = usePermission();
  const refresh = useRefresh();

  const canUpdate = can('users:update');
  const canDelete = can('users:delete');

  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'reject';
    user: { id: string; username: string; email: string };
    handler: () => void;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading, error } = trpc.users.listPending.useQuery();

  const approveMutation = trpc.users.approvePending.useMutation();
  const rejectMutation = trpc.users.rejectPending.useMutation();

  const { mutate: approve, isPending: isApproving } = useStandardMutation({
    mutateFn: approveMutation.mutateAsync,
    invalidate: refresh.users,
    onSuccessMessage: 'Utente approvato con successo',
    onErrorMessage: "Errore nell'approvazione",
    onSuccess: () => setConfirmOpen(false),
  });

  const { mutate: reject, isPending: isRejecting } = useStandardMutation({
    mutateFn: rejectMutation.mutateAsync,
    invalidate: refresh.users,
    onSuccessMessage: 'Utente rifiutato ed eliminato',
    onErrorMessage: 'Errore nel rifiuto',
    onSuccess: () => setConfirmOpen(false),
  });

  const handleApprove = (user: { id: string; username: string; email: string }) => {
    setConfirmAction({
      type: 'approve',
      user,
      handler: () => approve({ id: user.id }),
    });
    setConfirmOpen(true);
  };

  const handleReject = (user: { id: string; username: string; email: string }) => {
    setConfirmAction({
      type: 'reject',
      user,
      handler: () => reject({ id: user.id }),
    });
    setConfirmOpen(true);
  };

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <p>Caricamento...</p>
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
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium">
                    {user.identities?.[0]?.provider || 'LDAP'}
                  </span>
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
                          handleApprove({
                            id: user.id,
                            username: user.username,
                            email: user.email,
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

      {confirmAction && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={open => {
            if (!open) setConfirmAction(null);
            setConfirmOpen(open);
          }}
          title={
            confirmAction.type === 'approve'
              ? 'Approva utente'
              : 'Rifiuta utente'
          }
          description={
            confirmAction.type === 'approve'
              ? `Vuoi approvare l'accesso per "${confirmAction.user.username}"? L'utente potrà accedere al sistema.`
              : `Vuoi rifiutare la richiesta di "${confirmAction.user.username}"? L'account verrà eliminato definitivamente.`
          }
          confirmText={confirmAction.type === 'approve' ? 'Approva' : 'Rifiuta'}
          cancelText="Annulla"
          variant={confirmAction.type === 'reject' ? 'destructive' : 'default'}
          actionType={confirmAction.type === 'reject' ? 'delete' : undefined}
          onConfirm={() => confirmAction.handler()}
          isLoading={isApproving || isRejecting}
        />
      )}
    </>
  );
}
